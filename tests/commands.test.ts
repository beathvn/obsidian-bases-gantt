import { describe, expect, it, vi } from 'vitest';
import type { App, Command, PluginManifest } from 'obsidian';
import GanttForBasesPlugin from '../src/main';

async function registeredCommands(): Promise<Command[]> {
	const plugin = new GanttForBasesPlugin({} as App, {} as PluginManifest);
	const commands: Command[] = [];
	vi.spyOn(plugin, 'addCommand').mockImplementation((command) => {
		commands.push(command);
		return command;
	});
	await plugin.onload();
	return commands;
}

describe('command palette', () => {
	it('registers the Gantt commands', async () => {
		const names = (await registeredCommands()).map((c) => c.name);
		expect(names).toEqual([
			'Scroll to today',
			'Undo last change',
			'Create new task',
			'Zoom in',
			'Zoom out',
			'Day view',
			'Week view',
			'Month view',
			'Year view',
		]);
	});

	it('offers no command while no Gantt view is open', async () => {
		for (const command of await registeredCommands()) {
			expect(command.checkCallback!(true), command.name).toBe(false);
		}
	});
});
