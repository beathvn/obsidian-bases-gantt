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
import { DAYS_PER_UNIT, VIEW_MODE_ZOOM, ZoomController, dayShiftForX, drawQuarterBackdrop, withCachedDateFormats } from './zoom';

// ── Bar drag → dates: convert the drag distance in whole days ──
// Frappe maps a bar's absolute x/width back to dates via
// date_utils.add(gantt_start, x/column_width*step, unit), which parseInt()s
// the count. That truncates float noise in Week view (Saturday → Friday)
// and, in Month/Year view, whole months/years: every drag snaps the start
// to the 1st and collapses short tasks. Instead, shift the pre-drag dates
// by how far each edge moved, in whole days. Frappe positions a bar's start
// with a calendar mapping (day D of a month at D/31 of its column) but sizes
// it with 30-day months, so the start shift follows the mapping and a
// resized end follows the width math; that way the redrawn bar lands where
// it was released in every view. An edge that didn't move keeps its date,
// and a move keeps the task's length. Bar isn't exported, so its prototype
// is patched from the first rendered bar.
interface FrappeBar {
	/** ox/owidth are set by Frappe on mousedown, before any date is computed. */
	$bar: { getX(): number; getWidth(): number; ox?: number; owidth?: number };
	task: { _start: Date; _end: Date };
	gantt: Gantt & { config: { column_width: number; step: number; unit: string } };
	dragOrigin?: { ox: number; owidth: number; start: Date; end: Date };
}

function addDays(date: Date, days: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + days);
	return d;
}

let barDateMathPatched = false;
function patchBarDateMath(gantt: Gantt): void {
	if (barDateMathPatched) return;
	const bars = (gantt as unknown as { bars?: object[] }).bars;
	if (!bars?.length) return;
	const barProto = Object.getPrototypeOf(bars[0]) as {
		compute_start_end_date: (this: FrappeBar) => { new_start_date: Date; new_end_date: Date };
	};
	barProto.compute_start_end_date = function (this: FrappeBar) {
		const bar = this.$bar;
		const ox = bar.ox ?? bar.getX();
		const owidth = bar.owidth ?? bar.getWidth();
		// Capture the pre-drag dates on the first computation of each gesture
		// (task._start/_end get overwritten as the drag progresses). A new
		// mousedown with the bar elsewhere changes ox/owidth; one where it
		// ended back in place has unchanged dates, so the origin still holds.
		if (!this.dragOrigin || this.dragOrigin.ox !== ox || this.dragOrigin.owidth !== owidth) {
			this.dragOrigin = { ox, owidth, start: new Date(this.task._start), end: new Date(this.task._end) };
		}
		const { column_width, step, unit } = this.gantt.config;
		const pxPerDay = column_width / (step * DAYS_PER_UNIT[unit]);
		const x = bar.getX();
		const width = bar.getWidth();
		const startMoved = Math.abs(x - ox) > 0.5;
		const endMoved = Math.abs(x + width - ox - owidth) > 0.5;
		const startShift = startMoved ? dayShiftForX(this.gantt, this.dragOrigin.start, x - ox) : 0;
		const endShift = endMoved ? startShift + Math.round((width - owidth) / pxPerDay) : 0;
		return {
			new_start_date: addDays(this.dragOrigin.start, startShift),
			new_end_date: addDays(this.dragOrigin.end, endShift),
		};
	};
	barDateMathPatched = true;
}

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
	 * True from the first on_date_change of a drag until the mouseup that
	 * ends it. While true, onDataUpdated skips rebuilding the chart (which
	 * would re-sort rows and reset scroll under the user's mouse).
	 */
	private isDragging = false;
	/** Where the current mouse gesture on the chart started. */
	private mouseDownPos: { x: number; y: number } | null = null;
	/**
	 * Set on mouseup when the pointer moved since mousedown. Frappe fires a
	 * plain DOM click on the bar after any release, including a drag that
	 * snapped back without changing a date, so on_click checks this.
	 */
	private lastGestureMoved = false;
	private static readonly CLICK_SLOP_PX = 4;
	/** onDataUpdated was skipped during a drag and must re-run once it ends. */
	private skippedDataUpdate = false;
	/** Global mouseup handlers Frappe Gantt registers on document (for cleanup). */
	private capturedGlobalHandlers: EventListener[] = [];
	/** Recent drag-caused frontmatter writes, most recent last. */
	private undoStack: UndoBatch[] = [];
	private static readonly MAX_UNDO_ENTRIES = 20;
	/**
	 * Date changes of the drag in progress, keyed per file. Frappe fires
	 * on_date_change on every day boundary crossed (not once at release),
	 * so changes are collected here and only written on mouseup.
	 */
	private pendingDrag: UndoBatch | null = null;
	private zoom: ZoomController;

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.containerEl = containerEl;
	}

	onload(): void {
		GanttChartView.instances.add(this);
		this.containerEl.addClass('bases-gantt-view');
		this.ganttEl = this.containerEl.createDiv({ cls: 'gantt-wrapper' });
		this.registerContextMenu();
		this.zoom = new ZoomController(
			this.getStoredZoom(),
			() => this.gantt,
			() => this.afterRender(),
			(pxPerDay) => this.config.set('zoom', Math.round(pxPerDay * 1000) / 1000),
		);
		// Non-passive so a pinch / Ctrl+wheel can be kept from scrolling.
		this.registerDomEvent(this.ganttEl, 'wheel', (evt) => this.zoom.handleWheel(evt), { passive: false });
		this.registerDomEvent(this.ganttEl, 'mousedown', (evt) => {
			this.mouseDownPos = { x: evt.clientX, y: evt.clientY };
		}, true);
		// Bubble phase on document, so Frappe's own mouseup handler on the
		// SVG (which fires the final on_date_change) has already run, and
		// before the click that follows.
		this.registerDomEvent(document, 'mouseup', (evt) => {
			const down = this.mouseDownPos;
			this.mouseDownPos = null;
			this.lastGestureMoved = down !== null && Math.hypot(
				evt.clientX - down.x, evt.clientY - down.y,
			) > GanttChartView.CLICK_SLOP_PX;
			this.finishDrag();
		});
	}

	onunload(): void {
		GanttChartView.instances.delete(this);
		this.zoom.destroy();
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
		this.pendingDrag = null;
		this.isDragging = false;
		this.skippedDataUpdate = false;
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

	/** Record a file's pre-drag and current values for the drag in progress. */
	private recordDragChange(
		filePath: string,
		description: string,
		previous: Record<string, string | number>,
		next: Record<string, string | number>,
	): void {
		this.isDragging = true;
		if (!this.pendingDrag) {
			this.pendingDrag = { description, changes: [] };
		}
		// Keep the first (pre-drag) "previous" per file but the latest "next".
		const existing = this.pendingDrag.changes.find((c) => c.filePath === filePath);
		if (existing) {
			existing.previous = { ...previous, ...existing.previous };
			existing.next = next;
		} else {
			this.pendingDrag.changes.push({ filePath, previous, next });
		}
	}

	/** On mouseup: write the drag's final dates once, then offer undo. */
	private finishDrag(): void {
		const batch = this.pendingDrag;
		if (!batch) return;
		this.pendingDrag = null;

		this.isDragging = false;
		if (this.skippedDataUpdate) {
			this.skippedDataUpdate = false;
			this.onDataUpdated();
		}

		// Drop no-op changes — e.g. the bar was dragged out and back to
		// exactly where it started before the mouse was released.
		batch.changes = batch.changes.filter((c) => !recordsEqual(c.previous, c.next));
		if (batch.changes.length === 0) return;

		for (const change of batch.changes) {
			void this.writeFrontmatter(change.filePath, change.next);
		}

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

	/** Public: jump to the zoom level of a former fixed view mode (for command palette). */
	setViewMode(mode: string): void {
		const pxPerDay = VIEW_MODE_ZOOM[mode];
		if (pxPerDay) this.zoom.zoomTo(pxPerDay);
	}

	/** Public: zoom around the center of the chart (for command palette). */
	zoomIn(): void {
		this.zoom.zoomBy(1.5);
	}

	zoomOut(): void {
		this.zoom.zoomBy(1 / 1.5);
	}

	/** Saved zoom (pixels per day), falling back to the former "View mode" option. */
	private getStoredZoom(): number {
		const zoom = this.config?.get('zoom');
		if (typeof zoom === 'number' && zoom > 0) return zoom;
		return VIEW_MODE_ZOOM[this.config?.get('viewMode') as string] ?? VIEW_MODE_ZOOM.Day;
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
		// Rebuilding mid-drag would re-sort rows and jump the scroll position
		// under the user's mouse; finishDrag() re-runs this once it ends.
		if (this.isDragging) {
			this.skippedDataUpdate = true;
			return;
		}

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
			// "maintain_pos", which jumps back to the chart's original
			// scroll_to (earliest task / today) — e.g. right after every
			// drag's write — and recomputes the grid start from the new
			// task range. Keep the date at the left edge in place instead.
			const gantt = this.gantt;
			this.zoom.rerenderInPlace(() => gantt.refresh(tasks));
			this.afterRender();
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

		const barHeight = (this.config.get('barHeight') as number) || 30;
		const showProgress = (this.config.get('showProgress') as boolean) ?? false;
		const showExpectedProgress = (this.config.get('showExpectedProgress') as boolean) ?? false;

		// Calculate earliest task date to scroll to
		const earliestDate = this.getEarliestTaskDate(tasks);

		const options: GanttOptions = {
			...this.zoom.ganttOptions(),
			bar_height: barHeight,
			today_button: true,
			scroll_to: earliestDate || 'today',
			readonly: false,
			readonly_dates: false,
			readonly_progress: true,
			// Drag in whole days at every zoom (Frappe's Month and Year modes
			// otherwise snap to 7- and 30-day steps).
			snap_at: '1d',
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
				// A release after moving the mouse is a drag, not a click.
				if (this.lastGestureMoved) return;
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

				// Written once on mouseup by finishDrag(), not per tick.
				this.recordDragChange(ganttTask.filePath, `Moved "${ganttTask.name}"`, previous, updates);
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
			this.gantt = withCachedDateFormats(() => new Gantt(this.ganttEl, tasks, options));
			patchBarDateMath(this.gantt);
		} catch (e) {
			console.error('Bases Gantt: failed to initialize chart', e);
			this.ganttEl.empty();
			this.renderEmptyState(this.getTaskMapperConfig());
			return;
		} finally {
			document.addEventListener = origAdd;
		}
		this.capturedGlobalHandlers = captured;
		this.afterRender();
	}

	/** Decorations Frappe doesn't draw itself; needed after every Frappe render, which rebuilds the SVG. */
	private afterRender(): void {
		if (!this.gantt) return;
		drawQuarterBackdrop(this.gantt);
		// Milestone class can't be combined with the color class in
		// custom_class: Frappe Gantt throws on spaces in classList.add.
		for (const task of this.currentTasks) {
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
