import { App, PluginSettingTab, Setting } from 'obsidian';
import type BasesGanttPlugin from './main';
import { GanttChartView } from './gantt-view';

export interface BasesGanttSettings {
	/** Dragging a task also shifts every task that depends on it, directly or transitively. */
	moveDependentTasks: boolean;
	/** How many days a task without an end date is drawn. */
	defaultDurationDays: number;
}

export const DEFAULT_SETTINGS: BasesGanttSettings = {
	moveDependentTasks: true,
	defaultDurationDays: 91,
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
	}
}
