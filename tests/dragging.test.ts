import { describe, expect, it } from 'vitest';
import Gantt from 'frappe-gantt';
import { chartAt, DAY_VIEW, MONTH_VIEW, WEEK_VIEW, YEAR_VIEW } from './support/frappe';
import { dayShiftForX, dragSnapDays, xForDate } from '../src/zoom';
// Loading the view applies its patches to Frappe's prototype.
import '../src/gantt-view';

describe('dragSnapDays', () => {
	it.each([22, 45, 300])('snaps to whole days at %s px/day', (pxPerDay) => {
		expect(dragSnapDays(pxPerDay)).toBe(1);
	});

	it.each([0.2, 3.5, 21.9])('snaps to whole weeks at %s px/day', (pxPerDay) => {
		expect(dragSnapDays(pxPerDay)).toBe(7);
	});
});

describe('dayShiftForX', () => {
	const ganttStart = new Date(2025, 0, 1);
	const taskStart = new Date(2025, 0, 10);
	const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

	it('is 0 when the bar did not move', () => {
		expect(dayShiftForX(chartAt(ganttStart, MONTH_VIEW), taskStart, 0)).toBe(0);
	});

	it('converts pixels to whole days in Day view', () => {
		expect(dayShiftForX(chartAt(ganttStart, DAY_VIEW), taskStart, 3 * DAY_VIEW.column_width)).toBe(3);
	});

	it('rounds to the nearest day', () => {
		expect(dayShiftForX(chartAt(ganttStart, DAY_VIEW), taskStart, 2.6 * DAY_VIEW.column_width)).toBe(3);
	});

	it('moves backwards', () => {
		expect(dayShiftForX(chartAt(ganttStart, WEEK_VIEW), taskStart, -WEEK_VIEW.column_width)).toBe(-7);
	});

	it.each([
		['Month', MONTH_VIEW, 31],
		['Month', MONTH_VIEW, 45],
		['Year', YEAR_VIEW, 120],
	])('in %s view finds the day drawn where the bar was dropped (%s days)', (_, view, days) => {
		const chart = chartAt(ganttStart, view);
		const dx = xForDate(chart, addDays(taskStart, days)) - xForDate(chart, taskStart);
		expect(dayShiftForX(chart, taskStart, dx)).toBe(days);
	});
});

describe('dependent tasks (get_all_dependent_tasks)', () => {
	const dependentsOf = (map: Record<string, string[]>, id: string) =>
		(Gantt.prototype as unknown as { get_all_dependent_tasks(id: string): string[] })
			.get_all_dependent_tasks.call({ dependency_map: map }, id)
			.sort();

	it('finds direct dependents', () => {
		expect(dependentsOf({ a: ['b', 'c'] }, 'a')).toEqual(['b', 'c']);
	});

	it('finds the whole chain, not just direct dependents', () => {
		expect(dependentsOf({ a: ['b'], b: ['c'], c: ['d'] }, 'a')).toEqual(['b', 'c', 'd']);
	});

	it('lists a task reached on two paths once', () => {
		expect(dependentsOf({ a: ['b', 'c'], b: ['d'], c: ['d'] }, 'a')).toEqual(['b', 'c', 'd']);
	});

	it('stops at cycles and leaves out the dragged task', () => {
		expect(dependentsOf({ a: ['b'], b: ['a'] }, 'a')).toEqual(['b']);
	});

	it('finds nothing for a task without dependents', () => {
		expect(dependentsOf({ a: ['b'] }, 'b')).toEqual([]);
	});
});
