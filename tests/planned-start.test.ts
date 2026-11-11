import { describe, expect, it } from 'vitest';
import { anyColor, config, entry } from './support/entries';
import { mapEntriesToNotes } from '../src/note-mapper';

const map = (props: Record<string, string>) =>
	mapEntriesToNotes(
		[entry('A.md', props)],
		config({ plannedStartProperty: 'note.plannedStart' }),
		anyColor,
	);

describe('planned start', () => {
	it('starts the bar at the start date without a planned start', () => {
		expect(map({ start: '2023-01-01', end: '2025-06-01' })[0]).toMatchObject({
			start: '2023-01-01',
			startsPlanned: false,
			originalStart: undefined,
		});
	});

	it('starts the bar at the planned start', () => {
		expect(map({ start: '2023-01-01', plannedStart: '2025-05-01', end: '2025-06-01' })[0]).toMatchObject({
			start: '2025-05-01',
			startsPlanned: true,
		});
	});

	it('keeps the note\'s own start date as the original start', () => {
		expect(map({ start: '2023-01-01', plannedStart: '2025-05-01' })[0].originalStart).toBe('2023-01-01');
	});

	it('draws a note with only a planned start', () => {
		expect(map({ plannedStart: '2025-05-01' })[0]).toMatchObject({
			start: '2025-05-01',
			startsPlanned: true,
			originalStart: undefined,
		});
	});

	it('ignores an unreadable planned start', () => {
		expect(map({ start: '2023-01-01', plannedStart: 'someday' })[0]).toMatchObject({
			start: '2023-01-01',
			startsPlanned: false,
		});
	});
});
