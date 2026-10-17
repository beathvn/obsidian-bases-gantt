import { App, PluginSettingTab, Setting } from 'obsidian';
import type BasesGanttPlugin from './main';
import { GanttChartView } from './gantt-view';

export interface BasesGanttSettings {
	/** Dragging a task also shifts every task that depends on it, directly or transitively. */
	moveDependentTasks: boolean;
}

export const DEFAULT_SETTINGS: BasesGanttSettings = {
	moveDependentTasks: true,
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
	}
}
