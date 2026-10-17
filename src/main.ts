import { Plugin, debounce } from 'obsidian';
import { GanttChartView, getGanttViewOptions } from './gantt-view';
import { COLOR_CLASS_COUNT } from './task-mapper';
import { BasesGanttSettings, BasesGanttSettingTab, DEFAULT_SETTINGS } from './settings';

export default class BasesGanttPlugin extends Plugin {
	settings: BasesGanttSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new BasesGanttSettingTab(this.app, this));

		this.registerBasesView('gantt', {
			name: 'Gantt',
			icon: 'calendar-range',
			factory: (controller, containerEl) => {
				return new GanttChartView(controller, containerEl, this);
			},
			options: (config) => getGanttViewOptions(config),
		});

		// ── Command palette shortcuts ─────────────────────────────────

		this.addCommand({
			id: 'gantt-scroll-today',
			name: 'Scroll to today',
			icon: 'calendar',
			checkCallback: (checking) => {
				const view = this.getActiveGanttView();
				if (checking) return !!view;
				view?.scrollToToday();
			},
		});

		this.addCommand({
			id: 'gantt-undo',
			name: 'Undo last change',
			icon: 'undo-2',
			checkCallback: (checking) => {
				const view = this.getActiveGanttView();
				if (checking) return !!view;
				view?.undoLastChange();
			},
		});

		this.addCommand({
			id: 'gantt-create-task',
			name: 'Create new task',
			icon: 'plus',
			checkCallback: (checking) => {
				const view = this.getActiveGanttView();
				if (checking) return !!view;
				view?.createTaskAtToday();
			},
		});

		this.addCommand({
			id: 'gantt-zoom-in',
			name: 'Zoom in',
			icon: 'zoom-in',
			checkCallback: (checking) => {
				const view = this.getActiveGanttView();
				if (checking) return !!view;
				view?.zoomIn();
			},
		});

		this.addCommand({
			id: 'gantt-zoom-out',
			name: 'Zoom out',
			icon: 'zoom-out',
			checkCallback: (checking) => {
				const view = this.getActiveGanttView();
				if (checking) return !!view;
				view?.zoomOut();
			},
		});

		this.addCommand({
			id: 'gantt-view-day',
			name: 'Day view',
			checkCallback: (checking) => {
				const view = this.getActiveGanttView();
				if (checking) return !!view;
				view?.setViewMode('Day');
			},
		});

		this.addCommand({
			id: 'gantt-view-week',
			name: 'Week view',
			checkCallback: (checking) => {
				const view = this.getActiveGanttView();
				if (checking) return !!view;
				view?.setViewMode('Week');
			},
		});

		this.addCommand({
			id: 'gantt-view-month',
			name: 'Month view',
			checkCallback: (checking) => {
				const view = this.getActiveGanttView();
				if (checking) return !!view;
				view?.setViewMode('Month');
			},
		});

		this.addCommand({
			id: 'gantt-view-year',
			name: 'Year view',
			checkCallback: (checking) => {
				const view = this.getActiveGanttView();
				if (checking) return !!view;
				view?.setViewMode('Year');
			},
		});
	}

	async loadSettings() {
		const loaded = (await this.loadData()) as Partial<BasesGanttSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		// Copied so assigning colors never mutates DEFAULT_SETTINGS.
		this.settings.colorAssignments = { ...loaded?.colorAssignments };
		this.settings.valueColors = [...(loaded?.valueColors ?? [])];
		this.settings.popupProperties = [...(loaded?.popupProperties ?? [])];
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** Batches the saves from color changes, which can come on every render. */
	private saveSettingsSoon = debounce(() => void this.saveSettings(), 1000, true);

	/**
	 * Color slots for the values one view shows of a color-by property. A
	 * value keeps its slot as long as it's shown; a value that's gone frees
	 * its slot, and a new value gets the lowest free (or least used) slot.
	 * Slots in `blocked` (resembling a fixed value color) aren't used, unless
	 * that would leave none; a value holding one gets another slot.
	 */
	syncColors(key: string, values: string[], freeMissing: boolean, blocked: Set<number>): Record<string, number> {
		const assigned = (this.settings.colorAssignments[key] ??= {});
		const allowed = Array.from({ length: COLOR_CLASS_COUNT }, (_, i) => i).filter((i) => !blocked.has(i));
		if (allowed.length === 0) allowed.push(...Array.from({ length: COLOR_CLASS_COUNT }, (_, i) => i));
		let changed = false;
		const present = new Set(values);
		for (const [value, index] of Object.entries(assigned)) {
			if ((freeMissing && !present.has(value)) || !allowed.includes(index)) {
				delete assigned[value];
				changed = true;
			}
		}
		const counts = new Map(allowed.map((i) => [i, 0]));
		for (const index of Object.values(assigned)) counts.set(index, (counts.get(index) ?? 0) + 1);
		for (const value of values) {
			if (assigned[value] !== undefined) continue;
			// Lowest slot among the least used.
			const least = Math.min(...counts.values());
			const index = allowed.find((i) => counts.get(i) === least)!;
			assigned[value] = index;
			counts.set(index, least + 1);
			changed = true;
		}
		if (changed) this.saveSettingsSoon();
		return assigned;
	}

	/**
	 * Index in the "Value colors" setting of the color fixed for a color-by
	 * value (matched ignoring case and surrounding spaces), or -1.
	 */
	fixedColorIndex(value: string): number {
		const wanted = value.trim().toLowerCase();
		if (!wanted) return -1;
		return this.settings.valueColors.findIndex((v) => v.value.trim().toLowerCase() === wanted);
	}

	onunload() {
		// Don't lose color assignments still waiting to be saved.
		this.saveSettingsSoon.run();
	}

	private getActiveGanttView(): GanttChartView | null {
		// Prefer the instance inside the currently active workspace leaf
		for (const instance of GanttChartView.instances) {
			if (instance.isInActiveLeaf()) return instance;
		}
		// Fallback: return any instance
		for (const instance of GanttChartView.instances) {
			return instance;
		}
		return null;
	}
}
