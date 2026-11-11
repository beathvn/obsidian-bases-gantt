import { describe, expect, it } from 'vitest';
import { anyColor, config, entry } from './support/entries';
import { mapEntriesToTasks } from '../src/task-mapper';

const map = (props: Record<string, string>, overrides = {}) =>
	mapEntriesToTasks([entry('A.md', props)], config(overrides), anyColor)[0];

describe('open-ended tasks', () => {
	it('draws a task without an end date with the default length', () => {
		expect(map({ start: '2025-01-01' }, { defaultDurationDays: 5 })).toMatchObject({
			start: '2025-01-01',
			end: '2025-01-05',
			hasEnd: false,
		});
	});

	it('treats an unreadable end date as no end date', () => {
		expect(map({ start: '2025-01-01', end: 'later' }, { defaultDurationDays: 3 })).toMatchObject({
			end: '2025-01-03',
			hasEnd: false,
		});
	});

	it('is open-ended when no end property is configured', () => {
		expect(map({ start: '2025-01-01', end: '2025-02-01' }, { endProperty: null }).hasEnd).toBe(false);
	});

	it('keeps whole days across a daylight saving change', () => {
		// Europe/Vienna switches to summer time on 2025-03-30.
		expect(map({ start: '2025-03-29' }, { defaultDurationDays: 2 }).end).toBe('2025-03-30');
	});

	it('draws the default length of one day as a single day', () => {
		expect(map({ start: '2025-01-01' }, { defaultDurationDays: 1 })).toMatchObject({
			end: '2025-01-01',
			hasEnd: false,
		});
	});

	it('draws a zero-day default length as one day', () => {
		const task = map({ start: '2025-01-01' }, { defaultDurationDays: 0 });
		expect(task).toMatchObject({ end: '2025-01-01', hasEnd: false });
	});
});
