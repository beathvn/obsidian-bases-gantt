import { App, PluginSettingTab, Setting } from 'obsidian';
import type BasesGanttPlugin from './main';
import { GanttChartView } from './gantt-view';

export interface BasesGanttSettings {
	/** Dragging a task also shifts every task that depends on it, directly or transitively. */
	moveDependentTasks: boolean;
	/** How many days a task without an end date is drawn. */
	defaultDurationDays: number;
	/**
	 * Color slot per shown value of the color-by property, per view
	 * ("Projects.base::Gantt::note.status" → "done" → 2), so adding a value
	 * never recolors others. A value no longer shown frees its slot.
	 */
	colorAssignments: Record<string, Record<string, number>>;
	/** Colors fixed for specific values of the color-by property; other values use the palette. */
	valueColors: ValueColor[];
	/** Note properties listed in the hover popup, in this order. */
	popupProperties: string[];
	/** Show a preview of the note's content in the hover popup. */
	showNotePreview: boolean;
}

export interface ValueColor {
	value: string;
	/** CSS color, e.g. "#2e9e44". */
	color: string;
}

export const DEFAULT_SETTINGS: BasesGanttSettings = {
	moveDependentTasks: true,
	defaultDurationDays: 91,
	colorAssignments: {},
	valueColors: [],
	popupProperties: [],
	showNotePreview: true,
};

export class BasesGanttSettingTab extends PluginSettingTab {
	plugin: BasesGanttPlugin;

	constructor(app: App, plugin: BasesGanttPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Move dependent tasks along')
			.setDesc('When you drag a task, shift every task that depends on it by the same amount. Turn off to keep dependent tasks fixed in place.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.moveDependentTasks)
				.onChange(async (value) => {
					this.plugin.settings.moveDependentTasks = value;
					await this.plugin.saveSettings();
					for (const view of GanttChartView.instances) view.applyPluginSettings();
				}));

		new Setting(containerEl)
			.setName('Default length without end date')
			.setDesc('How many days a task without an end date is drawn. Dragging its right edge sets a real end date.')
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.defaultDurationDays))
					.setValue(String(this.plugin.settings.defaultDurationDays))
					.onChange(async (value) => {
						const days = Math.round(Number(value));
						if (!Number.isFinite(days) || days < 1) return;
						this.plugin.settings.defaultDurationDays = days;
						await this.plugin.saveSettings();
						// Part of the task mapping, so open charts are rebuilt.
						for (const view of GanttChartView.instances) view.onDataUpdated();
					});
			});

		new Setting(containerEl)
			.setName('Properties on hover')
			.setDesc('Note properties to show when you hover over a bar, separated by commas. Properties a note doesn\'t have are left out.')
			.addText((text) => text
				.setPlaceholder('status, owner, priority')
				.setValue(this.plugin.settings.popupProperties.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.popupProperties = value.split(',').map((p) => p.trim()).filter(Boolean);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Note preview on hover')
			.setDesc('Show a scrollable preview of the note\'s content in the hover popup.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.showNotePreview)
				.onChange(async (value) => {
					this.plugin.settings.showNotePreview = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Value colors')
			.setDesc('Give specific values of the "Color by" property a fixed color (matched ignoring case). Values not listed here get a color automatically.')
			.setHeading();

		const valueColors = this.plugin.settings.valueColors;
		for (const entry of valueColors) {
			const row = new Setting(containerEl)
				.addColorPicker((picker) => picker
					.setValue(entry.color)
					.onChange(async (color) => {
						entry.color = color;
						await this.saveAndRefresh();
					}))
				.addText((text) => text
					.setPlaceholder('Value, e.g. done')
					.setValue(entry.value)
					.onChange(async (value) => {
						entry.value = value;
						await this.saveAndRefresh();
					}))
				.addExtraButton((button) => button
					.setIcon('trash-2')
					.setTooltip('Remove')
					.onClick(async () => {
						valueColors.splice(valueColors.indexOf(entry), 1);
						await this.saveAndRefresh();
						this.display();
					}));
			row.settingEl.addClass('bases-gantt-value-color');
		}

		new Setting(containerEl)
			.addButton((button) => button
				.setButtonText('Add value')
				.onClick(async () => {
					valueColors.push({ value: '', color: '#3b82f6' });
					await this.plugin.saveSettings();
					this.display();
				}));
	}

	private async saveAndRefresh(): Promise<void> {
		await this.plugin.saveSettings();
		for (const view of GanttChartView.instances) view.onDataUpdated();
	}
}
