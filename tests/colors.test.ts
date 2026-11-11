import { describe, expect, it, vi } from 'vitest';
import { config, entry } from './support/entries';
import { loadedPlugin } from './support/plugin';
import { MAX_FIXED_COLORS, mapEntriesToTasks, type ColorFor } from '../src/task-mapper';
import { slotsResembling } from '../src/colors';

describe('bar color classes', () => {
	const classOf = (status: string | null, colorFor: ColorFor) =>
		mapEntriesToTasks(
			[entry('A.md', { start: '2025-01-01', end: '2025-01-05', status })],
			config({ colorByProperty: 'note.status' }),
			colorFor,
		)[0].custom_class;

	it('uses the palette class of the value\'s slot', () => {
		expect(classOf('doing', () => ({ slot: 4 }))).toBe('gantt-color-4');
	});

	it('uses the fixed class of a value with a fixed color', () => {
		expect(classOf('done', () => ({ fixed: 1 }))).toBe('gantt-fixed-1');
	});

	it('asks for the color of the property\'s value', () => {
		const colorFor = vi.fn<ColorFor>(() => ({ slot: 0 }));
		classOf('doing', colorFor);
		expect(colorFor).toHaveBeenCalledWith('doing');
	});

	it('leaves notes without a value uncolored', () => {
		expect(classOf(null, () => ({ slot: 4 }))).toBe('');
	});

	it('leaves bars uncolored without Color by', () => {
		const [task] = mapEntriesToTasks(
			[entry('A.md', { start: '2025-01-01', end: '2025-01-05', status: 'doing' })],
			config(),
			() => ({ slot: 4 }),
		);
		expect(task.custom_class).toBe('');
	});
});

describe('palette slots (syncColors)', () => {
	const KEY = 'Projects.base::Gantt::note.status';
	const none = new Set<number>();

	it('gives new values the lowest free slots', async () => {
		const plugin = await loadedPlugin();
		expect(plugin.syncColors(KEY, ['todo', 'doing', 'done'], true, none)).toEqual({ todo: 0, doing: 1, done: 2 });
	});

	it('keeps a value\'s slot when other values come and go', async () => {
		const plugin = await loadedPlugin();
		plugin.syncColors(KEY, ['todo', 'doing', 'done'], true, none);
		expect(plugin.syncColors(KEY, ['done', 'blocked'], true, none)).toEqual({ done: 2, blocked: 0 });
	});

	it('frees the slot of a value no longer shown', async () => {
		const plugin = await loadedPlugin();
		plugin.syncColors(KEY, ['todo', 'doing'], true, none);
		expect(plugin.syncColors(KEY, ['doing'], true, none)).toEqual({ doing: 1 });
	});

	it('keeps missing values when told not to free them', async () => {
		const plugin = await loadedPlugin();
		plugin.syncColors(KEY, ['todo', 'doing'], true, none);
		expect(plugin.syncColors(KEY, ['doing'], false, none)).toEqual({ todo: 0, doing: 1 });
	});

	it('reuses the least used slot once all are taken', async () => {
		const plugin = await loadedPlugin();
		const values = Array.from({ length: 9 }, (_, i) => `v${i}`);
		expect(plugin.syncColors(KEY, values, true, none).v8).toBe(0);
	});

	it('skips slots that look like a fixed color', async () => {
		const plugin = await loadedPlugin();
		expect(plugin.syncColors(KEY, ['a', 'b'], true, new Set([0, 1]))).toEqual({ a: 2, b: 3 });
	});

	it('moves a value off a slot that became blocked', async () => {
		const plugin = await loadedPlugin();
		plugin.syncColors(KEY, ['a'], true, none);
		expect(plugin.syncColors(KEY, ['a'], true, new Set([0]))).toEqual({ a: 1 });
	});

	it('uses every slot when all are blocked', async () => {
		const plugin = await loadedPlugin();
		expect(plugin.syncColors(KEY, ['a'], true, new Set([0, 1, 2, 3, 4, 5, 6, 7]))).toEqual({ a: 0 });
	});

	it('keeps assignments of different views apart', async () => {
		const plugin = await loadedPlugin();
		plugin.syncColors('One.base::Gantt::note.status', ['x'], true, none);
		expect(plugin.syncColors('Two.base::Gantt::note.status', ['y'], true, none)).toEqual({ y: 0 });
	});

	it('keeps slots stored in the settings', async () => {
		const plugin = await loadedPlugin({ colorAssignments: { [KEY]: { done: 5 } } });
		expect(plugin.syncColors(KEY, ['done', 'new'], true, none)).toEqual({ done: 5, new: 0 });
	});

	it('saves changed assignments by the time the plugin unloads', async () => {
		const plugin = await loadedPlugin();
		const saveData = vi.spyOn(plugin, 'saveData');
		plugin.syncColors(KEY, ['todo'], true, none);
		plugin.onunload();
		expect(saveData).toHaveBeenCalledWith(
			expect.objectContaining({ colorAssignments: { [KEY]: { todo: 0 } } }),
		);
	});
});

describe('fixed value colors (fixedColorIndex)', () => {
	const valueColors = [
		{ value: 'Done', color: '#2e9e44' },
		{ value: 'blocked', color: '#d00' },
	];

	it('finds a value ignoring case and surrounding spaces', async () => {
		const plugin = await loadedPlugin({ valueColors });
		expect(plugin.fixedColorIndex('  done ')).toBe(0);
	});

	it('returns -1 for a value without a fixed color', async () => {
		const plugin = await loadedPlugin({ valueColors });
		expect(plugin.fixedColorIndex('todo')).toBe(-1);
	});

	it('returns -1 for a blank value', async () => {
		const plugin = await loadedPlugin({ valueColors: [{ value: '', color: '#000' }] });
		expect(plugin.fixedColorIndex(' ')).toBe(-1);
	});

	it('ignores entries beyond the supported number of fixed colors', async () => {
		const many = Array.from({ length: MAX_FIXED_COLORS + 1 }, (_, i) => ({ value: `v${i}`, color: '#000' }));
		const plugin = await loadedPlugin({ valueColors: many });
		expect(plugin.fixedColorIndex(`v${MAX_FIXED_COLORS - 1}`)).toBe(MAX_FIXED_COLORS - 1);
		expect(plugin.fixedColorIndex(`v${MAX_FIXED_COLORS}`)).toBe(-1);
	});
});

describe('slotsResembling', () => {
	it('blocks no slots without fixed colors', () => {
		expect(slotsResembling([])).toEqual(new Set());
	});
});
