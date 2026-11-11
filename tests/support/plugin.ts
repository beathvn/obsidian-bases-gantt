import GanttForBasesPlugin from '../../src/main';
import type { GanttForBasesSettings } from '../../src/settings';
import type { App, PluginManifest } from 'obsidian';

/** A plugin instance with `data` as its stored data.json, settings loaded. */
export async function loadedPlugin(data: Partial<GanttForBasesSettings> | null = null): Promise<GanttForBasesPlugin> {
	const plugin = new GanttForBasesPlugin({} as App, {} as PluginManifest);
	plugin.loadData = async () => (data == null ? null : structuredClone(data));
	await plugin.loadSettings();
	return plugin;
}
