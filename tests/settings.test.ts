import { describe, expect, it } from 'vitest';
import type { BasesViewConfig } from 'obsidian';
import { loadedPlugin } from './support/plugin';
import { DEFAULT_SETTINGS, GanttForBasesSettingTab } from '../src/settings';
import { getGanttViewOptions, moveDescription } from '../src/gantt-view';

describe('plugin settings', () => {
	it('starts from the defaults without stored data', async () => {
		const plugin = await loadedPlugin();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('leaves dependent notes in place and draws open-ended notes one day long by default', () => {
		expect(DEFAULT_SETTINGS).toMatchObject({ moveDependentNotes: false, defaultDurationDays: 1, showNotePreview: true, showPopup: true });
	});

	it('moves dependent notes along when the setting was turned on', async () => {
		const plugin = await loadedPlugin({ moveDependentNotes: true });
		expect(plugin.settings.moveDependentNotes).toBe(true);
	});

	it('keeps stored values over the defaults', async () => {
		const plugin = await loadedPlugin({ moveDependentNotes: false, popupProperties: ['owner'] });
		expect(plugin.settings).toMatchObject({ moveDependentNotes: false, popupProperties: ['owner'], defaultDurationDays: 1 });
	});

	it('never changes the defaults through loaded settings', async () => {
		const plugin = await loadedPlugin();
		plugin.settings.colorAssignments.view = { done: 1 };
		plugin.settings.valueColors.push({ value: 'done', color: '#0f0' });
		plugin.settings.popupProperties.push('owner');
		expect(DEFAULT_SETTINGS).toMatchObject({ colorAssignments: {}, valueColors: [], popupProperties: [] });
	});
});

describe('view options', () => {
	const viewConfig = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] }) as unknown as BasesViewConfig;
	type Item = { key: string; displayName: string; default?: unknown; shouldHide?: () => boolean };
	const items = (values: Record<string, unknown> = {}) =>
		(getGanttViewOptions(viewConfig(values)) as unknown as { displayName: string; items: Item[] }[]);
	const item = (key: string, values: Record<string, unknown> = {}) =>
		items(values).flatMap((g) => g.items).find((i) => i.key === key)!;

	it('keeps the planned start options out of the main groups, in an Advanced group', () => {
		expect(items().map((g) => [g.displayName, g.items.map((i) => i.displayName)])).toEqual([
			['Properties', ['Start date', 'End date', 'Label', 'Dependencies', 'Color by', 'Progress']],
			['Display', ['Bar height', 'Show progress', 'Drag to set progress']],
			['Advanced', ['Planned start', 'Show original start']],
		]);
	});

	it.each(['progress', 'editProgress'])('hides %s while Show progress is off', (key) => {
		expect(item(key, { showProgress: false }).shouldHide!()).toBe(true);
	});

	it.each(['progress', 'editProgress'])('shows %s while Show progress is on', (key) => {
		expect(item(key, { showProgress: true }).shouldHide!()).toBe(false);
	});

	it.each([
		['showProgress', false],
		['editProgress', true],
		['showOriginalStart', true],
		['barHeight', 30],
	])('defaults %s to %s', (key, value) => {
		expect(item(key).default).toBe(value);
	});
});

describe('drag notice wording', () => {
	it('names the note', () => {
		expect(moveDescription('Design', { startsPlanned: false, startMoved: true })).toBe('Moved "Design"');
	});

	it('says the planned start moved when a bar from a planned start is moved', () => {
		expect(moveDescription('Design', { startsPlanned: true, startMoved: true })).toBe('Moved "Design" (planned start)');
	});

	it('does not mention the planned start when only the end was resized', () => {
		expect(moveDescription('Design', { startsPlanned: true, startMoved: false })).toBe('Moved "Design"');
	});
});

describe('plugin settings tab', () => {
	type Def = { name?: string; heading?: string; items?: Def[]; control?: { key: string } };

	it('keeps every hover option together in one Hover group', async () => {
		const plugin = await loadedPlugin();
		const tab = new GanttForBasesSettingTab({} as never, plugin);
		const hover = (tab.getSettingDefinitions() as unknown as Def[]).find((d) => d.heading === 'Hover');
		expect(hover?.items?.map((i) => [i.name, i.control?.key])).toEqual([
			['Show details on hover', 'showPopup'],
			['Properties on hover', 'popupProperties'],
			['Note preview on hover', 'showNotePreview'],
		]);
	});

	it('talks about notes, never tasks (a task is a checkbox in Obsidian)', async () => {
		const plugin = await loadedPlugin();
		const tab = new GanttForBasesSettingTab({} as never, plugin);
		const text = JSON.stringify(tab.getSettingDefinitions(), (key: string, value: unknown): unknown => (typeof value === 'function' || key === 'key' ? undefined : value));
		expect(text).toContain('Move dependent notes along');
		expect(text).not.toMatch(/task/i);
	});

	it('stores whether the hover popup is shown', async () => {
		const plugin = await loadedPlugin({ showPopup: false });
		expect(plugin.settings.showPopup).toBe(false);
	});
});
