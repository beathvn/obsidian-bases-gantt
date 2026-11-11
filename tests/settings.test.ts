import { describe, expect, it } from 'vitest';
import type { BasesViewConfig } from 'obsidian';
import { loadedPlugin } from './support/plugin';
import { DEFAULT_SETTINGS } from '../src/settings';
import { getGanttViewOptions } from '../src/gantt-view';

describe('plugin settings', () => {
	it('starts from the defaults without stored data', async () => {
		const plugin = await loadedPlugin();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('moves dependent tasks along and draws open-ended tasks one day long by default', () => {
		expect(DEFAULT_SETTINGS).toMatchObject({ moveDependentTasks: true, defaultDurationDays: 1, showNotePreview: true });
	});

	it('keeps stored values over the defaults', async () => {
		const plugin = await loadedPlugin({ moveDependentTasks: false, popupProperties: ['owner'] });
		expect(plugin.settings).toMatchObject({ moveDependentTasks: false, popupProperties: ['owner'], defaultDurationDays: 1 });
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

	it('groups the options into Properties and Display', () => {
		expect(items().map((g) => [g.displayName, g.items.map((i) => i.displayName)])).toEqual([
			['Properties', ['Start date', 'Planned start', 'End date', 'Label', 'Dependencies', 'Color by', 'Progress']],
			['Display', ['Bar height', 'Show progress', 'Show expected progress', 'Drag to set progress', 'Show original start', 'Show details on hover']],
		]);
	});

	it.each(['progress', 'showExpectedProgress', 'editProgress'])('hides %s while Show progress is off', (key) => {
		expect(item(key, { showProgress: false }).shouldHide!()).toBe(true);
	});

	it.each(['progress', 'showExpectedProgress', 'editProgress'])('shows %s while Show progress is on', (key) => {
		expect(item(key, { showProgress: true }).shouldHide!()).toBe(false);
	});

	it.each([
		['showProgress', false],
		['editProgress', true],
		['showOriginalStart', false],
		['showPopup', true],
		['barHeight', 30],
	])('defaults %s to %s', (key, value) => {
		expect(item(key).default).toBe(value);
	});
});
