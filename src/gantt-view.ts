import {
	type BasesAllOptions,
	type BasesPropertyId,
	type BasesViewConfig,
	BasesView,
	type QueryController,
	DateValue,
	NumberValue,
	Menu,
	Notice,
	MarkdownRenderer,
} from 'obsidian';
import Gantt from 'frappe-gantt';
import type { GanttOptions, PopupContext } from 'frappe-gantt';
import { mapEntriesToTasks, createGroupHeaderTask, GROUP_HEADER_PREFIX, type GanttTask, type TaskMapperConfig } from './task-mapper';
import { formatDateForFrontmatter, parseObsidianDate } from './date-utils';

// ── Week view: align to Monday and show the ISO calendar week number ──
// Frappe Gantt has no option for week-start-day or week numbers, so the
// shared "Week" view mode object and the date-setup routine are patched
// directly. This runs once at module load, before any Gantt is constructed.
function getISOWeekNumber(date: Date): number {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
	return Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
}

const weekMode = (Gantt as unknown as { VIEW_MODE: { WEEK: Record<string, unknown> } }).VIEW_MODE.WEEK;
const originalWeekLowerText = weekMode.lower_text as (d: Date, ld: Date, lang: string) => string;
weekMode.lower_text = (d: Date, ld: Date, lang: string) =>
	`W${getISOWeekNumber(d)} · ${originalWeekLowerText(d, ld, lang)}`;
weekMode.column_width = 160;

const ganttProto = Gantt.prototype as unknown as {
	setup_gantt_dates: (refresh?: boolean) => void;
	setup_date_values: () => void;
	setup_dates: (refresh?: boolean) => void;
	gantt_start: Date;
	config: { view_mode?: { name?: string } };
};
ganttProto.setup_dates = function (this: typeof ganttProto, refresh?: boolean): void {
	this.setup_gantt_dates(refresh);
	if (this.config.view_mode?.name === 'Week') {
		// Roll the computed grid start back to the Monday on/before it so
		// week columns always begin on Monday instead of an arbitrary day.
		const day = this.gantt_start.getDay();
		const diffToMonday = (day + 6) % 7;
		if (diffToMonday > 0) {
			this.gantt_start.setDate(this.gantt_start.getDate() - diffToMonday);
		}
	}
	this.setup_date_values();
};

/** One file's prior frontmatter values, so a drag-caused write can be reverted. */
interface UndoFileChange {
	filePath: string;
	previous: Record<string, string | number>;
	/** Latest values actually written, to detect a drag that ended back where it started. */
	next: Record<string, string | number>;
}

/** One undo-able user gesture (a single drag can touch several dependent tasks at once). */
interface UndoBatch {
	description: string;
	changes: UndoFileChange[];
}

function recordsEqual(a: Record<string, string | number>, b: Record<string, string | number>): boolean {
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	return keys.every((k) => a[k] === b[k]);
}

export class GanttChartView extends BasesView {
	type = 'gantt';

	/** Static registry of active instances for command palette integration. */
	static instances: Set<GanttChartView> = new Set();

	private containerEl: HTMLElement;
	private ganttEl: HTMLElement;
	private gantt: Gantt | null = null;
	private configSnapshot = '';
	private currentTasks: GanttTask[] = [];
	private taskMap: Map<string, GanttTask> = new Map();
	/**
	 * True from the first on_date_change/on_progress_change of a drag until
	 * ~500ms after the last one. While true, onDataUpdated skips rebuilding
	 * the task list — the live per-tick writes a drag produces would
	 * otherwise re-sort rows and reset scroll position under the user's
	 * mouse while they're still dragging.
	 */
	private isDragging = false;
	/** Global mouseup handlers Frappe Gantt registers on document (for cleanup). */
	private capturedGlobalHandlers: EventListener[] = [];
	/** Recent drag-caused frontmatter writes, most recent last. */
	private undoStack: UndoBatch[] = [];
	private static readonly MAX_UNDO_ENTRIES = 20;
	/**
	 * Batches on_date_change/on_progress_change calls into one undo step per
	 * drag gesture. Frappe Gantt fires on_date_change on every mousemove tick
	 * that crosses a day boundary (not just once at mouseup), so this is
	 * debounced rather than flushed on the next microtask — otherwise a
	 * single drag across several days would queue a separate undo entry (and
	 * Notice) per day.
	 */
	private pendingUndoBatch: UndoBatch | null = null;
	private undoFlushTimer: number | null = null;
	private static readonly UNDO_BATCH_DEBOUNCE_MS = 500;

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.containerEl = containerEl;
	}

	onload(): void {
		GanttChartView.instances.add(this);
		this.containerEl.addClass('bases-gantt-view');
		this.ganttEl = this.containerEl.createDiv({ cls: 'gantt-wrapper' });
		this.registerContextMenu();
	}

	onunload(): void {
		GanttChartView.instances.delete(this);
		if (this.gantt) {
			this.gantt.clear();
			this.gantt.$container?.remove();
			this.gantt = null;
		}
		for (const handler of this.capturedGlobalHandlers) {
			document.removeEventListener('mouseup', handler);
		}
		this.capturedGlobalHandlers = [];
		this.currentTasks = [];
		this.taskMap.clear();
		this.undoStack = [];
		this.pendingUndoBatch = null;
		this.isDragging = false;
		if (this.undoFlushTimer !== null) {
			window.clearTimeout(this.undoFlushTimer);
			this.undoFlushTimer = null;
		}
	}

	onResize(): void {
		// Frappe Gantt auto-fills width via SVG 100%, so no special handling needed
	}

	/** Check if this view is inside the currently active workspace leaf. */
	isInActiveLeaf(): boolean {
		return this.containerEl.closest('.workspace-leaf.mod-active') != null;
	}

	/** Public: scroll chart to today (for command palette). */
	scrollToToday(): void {
		this.gantt?.scroll_current();
	}

	/** Public: revert the most recent drag-caused frontmatter change (for command palette). */
	undoLastChange(): void {
		const batch = this.undoStack.pop();
		if (!batch) {
			new Notice('Nothing to undo.');
			return;
		}
		void Promise.all(
			batch.changes.map((change) => this.writeFrontmatter(change.filePath, change.previous))
		).then(() => {
			new Notice(`Undid: ${batch.description}`);
		});
	}

	/** Queue a file's prior/next values for undo, batching calls from the same drag gesture. */
	private queueUndo(
		filePath: string,
		description: string,
		previous: Record<string, string | number>,
		next: Record<string, string | number>,
	): void {
		this.isDragging = true;
		if (!this.pendingUndoBatch) {
			this.pendingUndoBatch = { description, changes: [] };
		}
		// Keep the first (pre-drag) "previous" per file but the latest "next":
		// on_date_change re-fires on every day boundary crossed during a
		// single drag, and undo should restore to before the drag started,
		// not to the second-to-last day.
		const existing = this.pendingUndoBatch.changes.find((c) => c.filePath === filePath);
		if (existing) {
			// New call's previous values win only for keys not already recorded.
			existing.previous = { ...previous, ...existing.previous };
			existing.next = next;
		} else {
			this.pendingUndoBatch.changes.push({ filePath, previous, next });
		}

		if (this.undoFlushTimer !== null) {
			window.clearTimeout(this.undoFlushTimer);
		}
		this.undoFlushTimer = window.setTimeout(() => {
			this.undoFlushTimer = null;
			this.flushUndoBatch();
		}, GanttChartView.UNDO_BATCH_DEBOUNCE_MS);
	}

	private flushUndoBatch(): void {
		this.isDragging = false;
		const batch = this.pendingUndoBatch;
		this.pendingUndoBatch = null;

		// Row order/positions weren't rebuilt during the drag (see
		// onDataUpdated); catch up now that it's over.
		this.onDataUpdated();

		if (!batch) return;

		// Drop no-op changes — e.g. the bar was dragged out and back to
		// exactly where it started before the mouse was released.
		batch.changes = batch.changes.filter((c) => !recordsEqual(c.previous, c.next));
		if (batch.changes.length === 0) return;

		this.undoStack.push(batch);
		if (this.undoStack.length > GanttChartView.MAX_UNDO_ENTRIES) {
			this.undoStack.shift();
		}

		const label = batch.changes.length > 1
			? `${batch.description} (+${batch.changes.length - 1} dependent)`
			: batch.description;
		this.showUndoNotice(label);
	}

	/** Show a Notice with an inline "Undo" action for a just-applied drag change. */
	private showUndoNotice(description: string): void {
		const notice = new Notice('', 6000);
		notice.noticeEl.empty();
		notice.noticeEl.createSpan({ text: description });
		const undoBtn = notice.noticeEl.createEl('button', {
			text: 'Undo',
			cls: 'gantt-undo-notice-btn',
		});
		undoBtn.addEventListener('click', (evt) => {
			evt.stopPropagation();
			notice.hide();
			this.undoLastChange();
		});
	}

	/** Public: switch view mode (for command palette). */
	setViewMode(mode: string): void {
		if (this.gantt) {
			this.gantt.change_view_mode(mode, true);
		}
	}

	/** Public: create a new task at today's date (for command palette). */
	createTaskAtToday(): void {
		const config = this.getTaskMapperConfig();
		if (!config.startProperty) {
			new Notice('Configure a start date property first.');
			return;
		}
		const today = formatDateForFrontmatter(new Date());
		const propName = this.extractPropertyName(config.startProperty);
		void this.createFileForView('New task', (frontmatter) => {
			frontmatter[propName] = today;
			if (config.endProperty) {
				const endPropName = this.extractPropertyName(config.endProperty);
				frontmatter[endPropName] = today;
			}
		});
	}

	onDataUpdated(): void {
		if (!this.data?.data || !this.ganttEl) return;
		// A drag writes frontmatter live (per day boundary crossed, not just
		// on mouseup), which round-trips back here mid-drag. Rebuilding the
		// task list now would re-sort rows and jump the scroll position
		// under the user's mouse; flushUndoBatch() re-runs this once the
		// drag actually ends instead.
		if (this.isDragging) return;

		const config = this.getTaskMapperConfig();
		const newSnapshot = JSON.stringify(config) + '|' + this.getDisplayConfigSnapshot();

		// Build tasks (potentially from grouped data)
		let tasks: GanttTask[];
		const groups = this.data.groupedData;
		const hasGroups = groups.length > 1 || (groups.length === 1 && groups[0].hasKey());
		if (hasGroups) {
			tasks = [];
			for (let i = 0; i < groups.length; i++) {
				const group = groups[i];
				const groupTasks = mapEntriesToTasks(group.entries, config);
				if (groupTasks.length === 0) continue;
				const label = group.hasKey() ? String(group.key) : 'Ungrouped';
				const header = createGroupHeaderTask(label, i, groupTasks);
				if (header) tasks.push(header);
				tasks.push(...groupTasks);
			}
		} else {
			tasks = mapEntriesToTasks(this.data.data, config);
		}

		this.currentTasks = tasks;
		this.taskMap.clear();
		for (const t of tasks) this.taskMap.set(t.id, t);

		if (tasks.length === 0) {
			this.renderEmptyState(config);
			return;
		}

		// Clear empty state if it was showing
		const emptyEl = this.containerEl.querySelector('.gantt-empty-state');
		if (emptyEl) emptyEl.remove();

		if (this.gantt && this.configSnapshot === newSnapshot) {
			// Only data changed, not config — refresh in place.
			// Frappe's refresh() re-renders via change_view_mode() with no
			// "maintain_pos", which jumps scrollLeft back to the chart's
			// original scroll_to (earliest task / today). Since a drag
			// writes frontmatter live (on every day boundary crossed, not
			// just on mouseup), that write round-trips through Obsidian's
			// metadata cache back into onDataUpdated mid-drag and yanks the
			// view out from under the user's mouse. Save and restore
			// scrollLeft around the refresh so it never visibly moves.
			const scrollLeft = this.gantt.$container.scrollLeft;
			this.gantt.refresh(tasks);
			this.gantt.$container.scrollLeft = scrollLeft;
		} else {
			// Config changed or first render — recreate
			this.configSnapshot = newSnapshot;
			this.initGantt(tasks);
		}
	}

	private getTaskMapperConfig(): TaskMapperConfig {
		let startProperty = this.config.getAsPropertyId('startDate');
		let endProperty = this.config.getAsPropertyId('endDate');
		let labelProperty = this.config.getAsPropertyId('label');
		let dependenciesProperty = this.config.getAsPropertyId('dependencies');
		let colorByProperty = this.config.getAsPropertyId('colorBy');
		let progressProperty = this.config.getAsPropertyId('progress');

		// Auto-detect properties from data when not manually configured
		if (!startProperty && this.data?.data?.length > 0) {
			const detected = this.autoDetectProperties();
			startProperty = detected.start ?? startProperty;
			endProperty = detected.end ?? endProperty;
			dependenciesProperty = detected.dependencies ?? dependenciesProperty;
			progressProperty = detected.progress ?? progressProperty;
			colorByProperty = detected.colorBy ?? colorByProperty;
		}

		return {
			startProperty,
			endProperty,
			labelProperty,
			dependenciesProperty,
			colorByProperty,
			progressProperty,
			showProgress: (this.config.get('showProgress') as boolean) ??
				(progressProperty != null), // auto-enable if progress property detected
		};
	}

	/**
	 * Auto-detect property mappings by inspecting the first entry's values
	 * and matching property names to common naming conventions.
	 */
	private autoDetectProperties(): {
		start: BasesPropertyId | null;
		end: BasesPropertyId | null;
		dependencies: BasesPropertyId | null;
		progress: BasesPropertyId | null;
		colorBy: BasesPropertyId | null;
	} {
		const entries = this.data?.data;
		if (!entries || entries.length === 0) {
			return { start: null, end: null, dependencies: null, progress: null, colorBy: null };
		}

		const firstEntry = entries[0];
		const dateProps: BasesPropertyId[] = [];
		const numberProps: BasesPropertyId[] = [];
		const stringProps: BasesPropertyId[] = [];

		for (const propId of this.allProperties) {
			const val = firstEntry.getValue(propId);
			if (val == null) continue;
			if (val instanceof DateValue) {
				dateProps.push(propId);
			} else if (val instanceof NumberValue) {
				numberProps.push(propId);
			} else {
				stringProps.push(propId);
			}
		}

		const getName = (id: BasesPropertyId): string => {
			const dot = id.indexOf('.');
			return (dot >= 0 ? id.slice(dot + 1) : id).toLowerCase().replace(/[-_]/g, '');
		};

		const findByKeywords = (props: BasesPropertyId[], keywords: string[]): BasesPropertyId | null => {
			for (const propId of props) {
				const name = getName(propId);
				if (keywords.some(k => name.includes(k))) return propId;
			}
			return null;
		};

		// Dates: match by name, fallback to positional (first = start, second = end)
		const startKeywords = ['start', 'begin', 'from', 'created'];
		const endKeywords = ['end', 'due', 'finish', 'deadline', 'until'];

		let start = findByKeywords(dateProps, startKeywords);
		let end = findByKeywords(dateProps, endKeywords);

		if (!start && dateProps.length > 0) start = dateProps[0];
		if (!end && dateProps.length > 1) end = dateProps.find(p => p !== start) ?? null;

		// Dependencies: look for link-like string properties
		const depKeywords = ['depend', 'block', 'after', 'prerequisite', 'requires'];
		const dependencies = findByKeywords(stringProps, depKeywords);

		// Progress: look for number properties with progress-like names
		const progressKeywords = ['progress', 'percent', 'completion', 'complete', 'done'];
		const progress = findByKeywords(numberProps, progressKeywords);

		// Color by: look for status/category-like string properties
		const colorKeywords = ['status', 'priority', 'type', 'category', 'phase', 'stage'];
		const colorBy = findByKeywords(stringProps, colorKeywords);

		return { start, end, dependencies, progress, colorBy };
	}

	private getDisplayConfigSnapshot(): string {
		return JSON.stringify({
			viewMode: this.config.get('viewMode'),
			barHeight: this.config.get('barHeight'),
			showProgress: this.config.get('showProgress'),
			showExpectedProgress: this.config.get('showExpectedProgress'),
		});
	}

	private initGantt(tasks: GanttTask[]): void {
		// Clear previous chart
		if (this.gantt) {
			this.gantt.clear();
			this.gantt = null;
		}
		this.ganttEl.empty();

		// Map stored config values to Frappe Gantt's expected format
		const VIEW_MODE_MAP: Record<string, string> = {
			'Quarter day': 'Quarter Day',
			'Half day': 'Half Day',
		};
		const rawViewMode = (this.config.get('viewMode') as string) || 'Day';
		const viewMode = VIEW_MODE_MAP[rawViewMode] ?? rawViewMode;
		const barHeight = (this.config.get('barHeight') as number) || 30;
		const showProgress = (this.config.get('showProgress') as boolean) ?? false;
		const showExpectedProgress = (this.config.get('showExpectedProgress') as boolean) ?? false;

		// Calculate earliest task date to scroll to
		const earliestDate = this.getEarliestTaskDate(tasks);

		const options: GanttOptions = {
			view_mode: viewMode,
			bar_height: barHeight,
			today_button: true,
			scroll_to: earliestDate || 'today',
			readonly: false,
			readonly_dates: false,
			readonly_progress: !showProgress,
			infinite_padding: false,
			view_mode_select: false,

			// Enhanced options
			arrow_curve: 15,
			auto_move_label: true,
			move_dependencies: true,
			show_expected_progress: showExpectedProgress && showProgress,
			hover_on_date: true,
			popup_on: 'hover',

			// Rich hover popup
			popup: (ctx: PopupContext) => {
				this.renderPopup(ctx, showProgress);
			},

			on_click: (task) => {
				// Frappe fires a plain DOM "click" on the bar group on mouseup
				// with no drag-awareness of its own, so a drag or resize that
				// ends with the mouse over the bar would otherwise also open
				// the note. isDragging spans the whole gesture (see
				// queueUndo/flushUndoBatch), so it's still true for the click
				// that immediately follows a drag-ending mouseup.
				if (this.isDragging) return;
				// Ignore group header phantom tasks
				if (task.id.startsWith(GROUP_HEADER_PREFIX)) return;
				const ganttTask = this.findTask(task.id);
				if (ganttTask) {
					void this.app.workspace.openLinkText(ganttTask.filePath, '', false);
				}
			},

			on_date_change: (task, start, end) => {
				if (task.id.startsWith(GROUP_HEADER_PREFIX)) return;
				const ganttTask = this.findTask(task.id);
				if (!ganttTask) return;

				const mapperConfig = this.getTaskMapperConfig();
				const updates: Record<string, string> = {};
				const previous: Record<string, string> = {};

				if (mapperConfig.startProperty) {
					const propName = this.extractPropertyName(mapperConfig.startProperty);
					previous[propName] = ganttTask.start;
					updates[propName] = formatDateForFrontmatter(start);
				}
				if (mapperConfig.endProperty) {
					const propName = this.extractPropertyName(mapperConfig.endProperty);
					previous[propName] = ganttTask.end;
					updates[propName] = formatDateForFrontmatter(end);
				}

				this.queueUndo(ganttTask.filePath, `Moved "${ganttTask.name}"`, previous, updates);

				// Write directly — no debounce. on_date_change fires on every
				// mousemove tick that crosses a day boundary (and multiple
				// bars fire synchronously when move_dependencies is true), so
				// this keeps writing the latest value each time; a shared
				// debounce would drop all but the last bar's update.
				void this.writeFrontmatter(ganttTask.filePath, updates);
			},

			on_progress_change: (task, progress) => {
				if (!showProgress) return;
				const ganttTask = this.findTask(task.id);
				if (!ganttTask) return;

				const mapperConfig = this.getTaskMapperConfig();
				if (mapperConfig.progressProperty) {
					const propName = this.extractPropertyName(mapperConfig.progressProperty);
					const rounded = Math.round(progress);
					this.queueUndo(
						ganttTask.filePath,
						`Changed progress on "${ganttTask.name}"`,
						{ [propName]: ganttTask.progress ?? 0 },
						{ [propName]: rounded },
					);
					void this.writeFrontmatter(ganttTask.filePath, {
						[propName]: rounded,
					});
				}
			},

			on_date_click: (dateStr: string) => {
				this.createTaskAtDate(dateStr);
			},
		};

		// Capture global mouseup handlers Frappe Gantt registers on document
		// so we can remove them on cleanup (Frappe never removes them itself).
		// The Gantt constructor is fully synchronous so this is safe.
		const captured: EventListener[] = [];
		const origAdd = document.addEventListener.bind(document);
		document.addEventListener = ((
			type: string,
			listener: EventListenerOrEventListenerObject,
			options?: boolean | AddEventListenerOptions,
		) => {
			if (type === 'mouseup') {
				captured.push(listener as EventListener);
			}
			return origAdd(type, listener, options);
		}) as typeof document.addEventListener;

		try {
			this.gantt = new Gantt(this.ganttEl, tasks, options);
		} catch (e) {
			console.error('Bases Gantt: failed to initialize chart', e);
			this.ganttEl.empty();
			this.renderEmptyState(this.getTaskMapperConfig());
			return;
		} finally {
			document.addEventListener = origAdd;
		}
		this.capturedGlobalHandlers = captured;

		// Apply milestone class to bar wrappers (can't combine with color class
		// in custom_class because Frappe Gantt throws on spaces in classList.add)
		for (const task of tasks) {
			if (task.isMilestone) {
				const wrapper = this.ganttEl.querySelector(`.bar-wrapper[data-id="${task.id}"]`);
				if (wrapper) wrapper.classList.add('gantt-milestone');
			}
		}

	}

	// ── Rich hover popup ──────────────────────────────────────────────

	/** Render content inside Frappe Gantt's hover popup. */
	private renderPopup(ctx: PopupContext, showProgress: boolean): void {
		const ganttTask = this.findTask(ctx.task.id);

		// Group headers: just show the label
		if (!ganttTask || ganttTask.id.startsWith(GROUP_HEADER_PREFIX)) {
			ctx.set_title(`<strong>${this.escapeHtml(ctx.task.name)}</strong>`);
			return;
		}

		// Title
		ctx.set_title(this.escapeHtml(ctx.task.name));

		// Subtitle: date range + duration
		const start = ctx.task._start;
		const end = ctx.task._end;
		if (start && end) {
			const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
			ctx.set_subtitle(
				`${this.formatDisplayDate(start)} &rarr; ${this.formatDisplayDate(end)} &middot; ${days} day${days !== 1 ? 's' : ''}`
			);
		}

		// Details: progress bar + dependencies + hint
		const parts: string[] = [];

		if (showProgress && ctx.task.progress != null) {
			const pct = Math.round(ctx.task.progress);
			parts.push(
				`<div class="gantt-popup-progress-row">` +
				`<div class="gantt-popup-progress"><div class="gantt-popup-progress-bar" style="width:${pct}%"></div></div>` +
				`<span class="gantt-popup-progress-label">${pct}%</span>` +
				`</div>`
			);
		}

		if (ctx.task.dependencies) {
			const depNames = ctx.task.dependencies.split(',')
				.map(d => d.trim()).filter(Boolean)
				.map(depId => {
					const depTask = this.findTask(depId);
					return depTask ? this.escapeHtml(depTask.name) : depId;
				});
			if (depNames.length > 0) {
				parts.push(`<div class="gantt-popup-deps">Depends on: ${depNames.join(', ')}</div>`);
			}
		}

		parts.push(`<div class="gantt-popup-hint">Click to open &middot; Right-click for options</div>`);
		ctx.set_details(parts.join(''));

		// Async: render a markdown preview of the note body
		void this.renderPopupPreview(ganttTask);
	}

	/** Asynchronously render a truncated markdown preview in the popup. */
	private async renderPopupPreview(ganttTask: GanttTask): Promise<void> {
		const file = this.app.vault.getFileByPath(ganttTask.filePath);
		if (!file) return;

		const content = await this.app.vault.cachedRead(file);

		// Strip frontmatter
		const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
		const body = bodyMatch ? bodyMatch[1].trim() : content.trim();
		if (!body) return;

		const preview = body.length > 300 ? body.substring(0, 300) + '...' : body;

		// Check popup is still visible
		const popupEl = this.ganttEl.querySelector('.popup-wrapper');
		if (!popupEl || popupEl.querySelector('.gantt-popup-preview')) return;

		const previewDiv = document.createElement('div');
		previewDiv.className = 'gantt-popup-preview';
		popupEl.appendChild(previewDiv);

		await MarkdownRenderer.render(this.app, preview, previewDiv, ganttTask.filePath, this);
	}

	/** Format a date for display in popups (shorter, human-friendly). */
	private formatDisplayDate(date: Date): string {
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
	}

	/** Escape HTML to prevent XSS in popup content. */
	private escapeHtml(str: string): string {
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	// ── Right-click context menus ─────────────────────────────────────

	/** Register right-click context menu on the Gantt chart (once, in onload). */
	private registerContextMenu(): void {
		this.ganttEl.addEventListener('contextmenu', (evt: MouseEvent) => {
			evt.preventDefault();

			const target = evt.target as Element;
			const barWrapper = target.closest('.bar-wrapper');

			if (barWrapper) {
				const taskId = barWrapper.getAttribute('data-id');
				if (taskId) {
					const ganttTask = this.findTask(taskId);
					if (ganttTask && !ganttTask.id.startsWith(GROUP_HEADER_PREFIX)) {
						this.showTaskContextMenu(evt, ganttTask);
						return;
					}
				}
			}

			this.showEmptyContextMenu(evt);
		});
	}

	/** Context menu for a specific task bar. */
	private showTaskContextMenu(evt: MouseEvent, task: GanttTask): void {
		const menu = new Menu();

		menu.addItem((item) => {
			item.setTitle('Open note')
				.setIcon('file-text')
				.onClick(() => {
					void this.app.workspace.openLinkText(task.filePath, '', false);
				});
		});

		menu.addItem((item) => {
			item.setTitle('Open in new tab')
				.setIcon('file-plus')
				.onClick(() => {
					void this.app.workspace.openLinkText(task.filePath, '', true);
				});
		});

		menu.addSeparator();

		const showProgress = (this.config.get('showProgress') as boolean) ?? false;
		if (showProgress) {
			for (const pct of [0, 25, 50, 75, 100]) {
				menu.addItem((item) => {
					item.setTitle(`Set progress: ${pct}%`)
						.setChecked(Math.round(task.progress ?? 0) === pct)
						.onClick(() => {
							const mapperConfig = this.getTaskMapperConfig();
							if (mapperConfig.progressProperty) {
								const propName = this.extractPropertyName(mapperConfig.progressProperty);
								void this.writeFrontmatter(task.filePath, {
									[propName]: pct,
								});
								// Instant visual feedback
								this.gantt?.update_task(task.id, { progress: pct });
							}
						});
				});
			}
			menu.addSeparator();
		}

		menu.addItem((item) => {
			item.setTitle('Scroll to today')
				.setIcon('calendar')
				.onClick(() => this.gantt?.scroll_current());
		});

		menu.showAtMouseEvent(evt);
	}

	/** Context menu for empty chart space. */
	private showEmptyContextMenu(evt: MouseEvent): void {
		const menu = new Menu();

		menu.addItem((item) => {
			item.setTitle('Create new task')
				.setIcon('plus')
				.onClick(() => this.createTaskAtToday());
		});

		menu.addSeparator();

		menu.addItem((item) => {
			item.setTitle('Scroll to today')
				.setIcon('calendar')
				.onClick(() => this.gantt?.scroll_current());
		});

		menu.showAtMouseEvent(evt);
	}

	// ── Click-to-create ───────────────────────────────────────────────

	/** Create a new task at a specific date (from on_date_click). */
	private createTaskAtDate(dateStr: string): void {
		const config = this.getTaskMapperConfig();
		if (!config.startProperty) {
			new Notice('Configure a start date property first.');
			return;
		}

		// Parse and re-format to ensure consistent YYYY-MM-DD
		const parsed = parseObsidianDate(dateStr);
		const formattedDate = parsed ? formatDateForFrontmatter(parsed) : dateStr;

		const propName = this.extractPropertyName(config.startProperty);
		void this.createFileForView('New task', (frontmatter) => {
			frontmatter[propName] = formattedDate;
			if (config.endProperty) {
				const endPropName = this.extractPropertyName(config.endProperty);
				frontmatter[endPropName] = formattedDate;
			}
		});
	}

	// ── Helpers ───────────────────────────────────────────────────────

	/** Find the earliest start date string among tasks, for initial scroll. */
	private getEarliestTaskDate(tasks: GanttTask[]): string | null {
		let earliest: string | null = null;
		for (const t of tasks) {
			if (!earliest || t.start < earliest) {
				earliest = t.start;
			}
		}
		return earliest;
	}

	private findTask(id: string): GanttTask | undefined {
		return this.taskMap.get(id);
	}

	/**
	 * Extract the property name from a BasesPropertyId (e.g. "note.start-date" -> "start-date").
	 */
	private extractPropertyName(propertyId: BasesPropertyId): string {
		const dotIndex = propertyId.indexOf('.');
		return dotIndex >= 0 ? propertyId.slice(dotIndex + 1) : propertyId;
	}

	private async writeFrontmatter(
		filePath: string,
		updates: Record<string, string | number>,
	): Promise<void> {
		const file = this.app.vault.getFileByPath(filePath);
		if (!file) return;

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			for (const [key, value] of Object.entries(updates)) {
				frontmatter[key] = value;
			}
		});
	}

	private renderEmptyState(config: TaskMapperConfig): void {
		if (this.gantt) {
			this.gantt.clear();
			this.gantt = null;
		}
		this.ganttEl.empty();

		// Remove any existing empty state
		const existing = this.containerEl.querySelector('.gantt-empty-state');
		if (existing) existing.remove();

		const el = this.containerEl.createDiv({ cls: 'gantt-empty-state' });

		if (!config.startProperty) {
			el.createEl('p', {
				text: 'Configure a start date property in the view options to display the chart.',
			});
			el.createEl('p', {
				cls: 'gantt-empty-hint',
				text: 'Open view options (gear icon) and select a date property for "start date".',
			});
		} else {
			el.createEl('p', {
				text: 'No tasks with valid dates found.',
			});
			el.createEl('p', {
				cls: 'gantt-empty-hint',
				text: 'Ensure your notes have a date value in the configured start date property.',
			});
		}
	}
}

/**
 * Return the view options for the Bases config sidebar.
 */
export function getGanttViewOptions(config: BasesViewConfig): BasesAllOptions[] {
	return [
		{
			type: 'group',
			displayName: 'Properties',
			items: [
				{
					type: 'property',
					key: 'startDate',
					displayName: 'Start date',
					placeholder: 'Select property...',
				},
				{
					type: 'property',
					key: 'endDate',
					displayName: 'End date',
					placeholder: 'Select property...',
				},
				{
					type: 'property',
					key: 'label',
					displayName: 'Label',
					placeholder: 'File name (default)',
				},
				{
					type: 'property',
					key: 'dependencies',
					displayName: 'Dependencies',
					placeholder: 'Select property...',
				},
				{
					type: 'property',
					key: 'colorBy',
					displayName: 'Color by',
					placeholder: 'Select property...',
				},
				{
					type: 'property',
					key: 'progress',
					displayName: 'Progress',
					placeholder: 'Select property...',
					shouldHide: () => !(config.get('showProgress') as boolean),
				},
			],
		},
		{
			type: 'group',
			displayName: 'Display',
			items: [
				{
					type: 'dropdown',
					key: 'viewMode',
					displayName: 'View mode',
					default: 'Day',
					options: {
						'Quarter day': 'Quarter day',
						'Half day': 'Half day',
						Day: 'Day',
						Week: 'Week',
						Month: 'Month',
						Year: 'Year',
					},
				},
				{
					type: 'slider',
					key: 'barHeight',
					displayName: 'Bar height',
					default: 30,
					min: 16,
					max: 60,
					step: 2,
				},
				{
					type: 'toggle',
					key: 'showProgress',
					displayName: 'Show progress',
					default: false,
				},
				{
					type: 'toggle',
					key: 'showExpectedProgress',
					displayName: 'Show expected progress',
					default: false,
					shouldHide: () => !(config.get('showProgress') as boolean),
				},
			],
		},
	];
}
