import { describe, expect, it } from 'vitest';
import { DateValue, NullValue, NumberValue, StringValue } from './support/obsidian';
import { anyColor, config, entry } from './support/entries';
import {
	GROUP_HEADER_PREFIX,
	createGroupHeaderBar,
	escapeHtml,
	extractRawValue,
	isDependencyName,
	mapEntriesToNotes,
	type GanttNote,
} from '../src/note-mapper';
import type { Value } from 'obsidian';

const map = (entries: ReturnType<typeof entry>[], overrides = {}) =>
	mapEntriesToNotes(entries, config(overrides), anyColor);

const names = (notes: GanttNote[]) => notes.map((t) => t.label);

describe('extractRawValue', () => {
	it('returns null for a missing value', () => {
		expect(extractRawValue(null)).toBeNull();
	});

	it('returns null for a null value', () => {
		expect(extractRawValue(new NullValue() as unknown as Value)).toBeNull();
	});

	it('drops the time of a datetime value', () => {
		const value = new DateValue(new Date(2025, 4, 6, 13, 45), true) as unknown as Value;
		expect(extractRawValue(value)).toBe('2025-05-06');
	});

	it('returns other values as text', () => {
		expect(extractRawValue(new NumberValue(42) as unknown as Value)).toBe('42');
		expect(extractRawValue(new StringValue('hi') as unknown as Value)).toBe('hi');
	});
});

describe('escapeHtml', () => {
	it('escapes every HTML special character', () => {
		expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
			'&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
		);
	});
});

describe('mapEntriesToNotes: bars', () => {
	it('maps nothing without a start property', () => {
		expect(map([entry('A.md', { start: '2025-01-01' })], { startProperty: null })).toEqual([]);
	});

	it('skips notes without a start date', () => {
		const notes = map([entry('A.md', { start: '2025-01-01' }), entry('B.md'), entry('C.md', { start: 'soon' })]);
		expect(names(notes)).toEqual(['A']);
	});

	it('takes start and end from the note', () => {
		const [note] = map([entry('A.md', { start: '2025-01-01', end: '2025-01-10' })]);
		expect(note).toMatchObject({ start: '2025-01-01', end: '2025-01-10', hasEnd: true, filePath: 'A.md' });
	});

	it('reads date values Bases hands over', () => {
		const [note] = map([entry('A.md', { start: new Date(2025, 0, 1), end: new Date(2025, 0, 3) })]);
		expect(note).toMatchObject({ start: '2025-01-01', end: '2025-01-03' });
	});

	it('draws an end before the start as one day long', () => {
		const [note] = map([entry('A.md', { start: '2025-01-10', end: '2025-01-01' })]);
		expect(note).toMatchObject({ start: '2025-01-10', end: '2025-01-10' });
	});
});

describe('mapEntriesToNotes: notes on a single day', () => {
	it('draws a note ending on its start day as a plain one-day bar', () => {
		const [note] = map([entry('A.md', { start: '2025-01-10', end: '2025-01-10' })]);
		expect(note).toMatchObject({ start: '2025-01-10', end: '2025-01-10', custom_class: '' });
		expect(note).not.toHaveProperty('isMilestone');
	});

	it('keeps the color class of a colored one-day bar', () => {
		const [note] = mapEntriesToNotes(
			[entry('A.md', { start: '2025-01-10', end: '2025-01-10', status: 'done' })],
			config({ colorByProperty: 'note.status' }),
			() => ({ slot: 3 }),
		);
		expect(note.custom_class).toBe('gantt-color-3');
	});
});

describe('mapEntriesToNotes: IDs', () => {
	it('encodes the file path into a CSS-safe ID', () => {
		const [note] = map([entry('Notes/A.md', { start: '2025-01-01' })]);
		expect(note.id).toBe('Notes_2f_A_2e_md');
	});

	it('gives paths that differ only in "_" or "/" different IDs', () => {
		const notes = map([
			entry('a_2f_b.md', { start: '2025-01-01' }),
			entry('a/b.md', { start: '2025-01-01' }),
		]);
		expect(new Set(notes.map((t) => t.id)).size).toBe(2);
	});

	it('uses only letters, digits, "-" and "_"', () => {
		const [note] = map([entry('Projekte/Über, "Plan" #1.md', { start: '2025-01-01' })]);
		expect(note.id).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe('mapEntriesToNotes: labels', () => {
	it('uses the file name by default', () => {
		const [note] = map([entry('folder/My note.md', { start: '2025-01-01' })]);
		expect(note.label).toBe('My note');
	});

	it('uses the label property when set', () => {
		const [note] = map([entry('A.md', { start: '2025-01-01', title: 'Launch' })], { labelProperty: 'note.title' });
		expect(note.label).toBe('Launch');
	});

	it('falls back to the file name for a blank label', () => {
		const [note] = map([entry('A.md', { start: '2025-01-01', title: '  ' })], { labelProperty: 'note.title' });
		expect(note.label).toBe('A');
	});

	it('HTML-escapes the name Frappe renders but keeps the plain label', () => {
		const [note] = map([entry('A.md', { start: '2025-01-01', title: '<img src=x onerror=alert(1)>' })], {
			labelProperty: 'note.title',
		});
		expect(note.name).toBe('&lt;img src=x onerror=alert(1)&gt;');
		expect(note.label).toBe('<img src=x onerror=alert(1)>');
	});
});

describe('mapEntriesToNotes: dependencies', () => {
	const withDeps = (deps: string, others = [entry('folder/Design.md', { start: '2025-01-01' })]) => {
		const notes = map([...others, entry('Build.md', { start: '2025-02-01', after: deps })], {
			dependenciesProperty: 'note.after',
		});
		return notes.find((t) => t.label === 'Build')!.dependencies;
	};

	it('resolves a [[link]] by basename', () => {
		expect(withDeps('[[Design]]')).toBe('folder_2f_Design_2e_md');
	});

	it('resolves a [[link]] by path', () => {
		expect(withDeps('[[folder/Design]]')).toBe('folder_2f_Design_2e_md');
	});

	it('resolves an aliased [[link|alias]]', () => {
		expect(withDeps('[[Design|the design]]')).toBe('folder_2f_Design_2e_md');
	});

	it('resolves several links, comma-separated in the result', () => {
		const others = [entry('Design.md', { start: '2025-01-01' }), entry('Spec.md', { start: '2025-01-02' })];
		expect(withDeps('[[Design]], [[Spec]]', others)).toBe('Design_2e_md, Spec_2e_md');
	});

	it('resolves plain comma-separated names', () => {
		const others = [entry('Design.md', { start: '2025-01-01' }), entry('Spec.md', { start: '2025-01-02' })];
		expect(withDeps('Design, Spec', others)).toBe('Design_2e_md, Spec_2e_md');
	});

	it('ignores links to notes outside the base', () => {
		expect(withDeps('[[Elsewhere]]')).toBe('');
	});
});

describe('mapEntriesToNotes: order', () => {
	it('sorts by start date', () => {
		const notes = map([
			entry('C.md', { start: '2025-03-01' }),
			entry('A.md', { start: '2025-01-01' }),
			entry('B.md', { start: '2025-02-01' }),
		]);
		expect(names(notes)).toEqual(['A', 'B', 'C']);
	});

	it('puts a note after the notes it depends on, even if it starts earlier', () => {
		const notes = map(
			[
				entry('Early.md', { start: '2025-01-01', after: '[[Late]]' }),
				entry('Middle.md', { start: '2025-01-15' }),
				entry('Late.md', { start: '2025-02-01' }),
			],
			{ dependenciesProperty: 'note.after' },
		);
		expect(names(notes)).toEqual(['Middle', 'Late', 'Early']);
	});

	it('keeps every note when dependencies are circular', () => {
		const notes = map(
			[
				entry('A.md', { start: '2025-01-02', after: '[[B]]' }),
				entry('B.md', { start: '2025-01-01', after: '[[A]]' }),
			],
			{ dependenciesProperty: 'note.after' },
		);
		expect(names(notes)).toEqual(['B', 'A']);
	});
});

describe('createGroupHeaderBar', () => {
	const note = (start: string, end: string) =>
		map([entry(`${start}.md`, { start, end })])[0];

	it('returns null for an empty group', () => {
		expect(createGroupHeaderBar('Empty', 0, [])).toBeNull();
	});

	it('spans the dates of all notes in the group', () => {
		const header = createGroupHeaderBar('Team', 2, [
			note('2025-02-01', '2025-02-10'),
			note('2025-01-05', '2025-01-08'),
			note('2025-01-20', '2025-03-01'),
		])!;
		expect(header).toMatchObject({
			id: `${GROUP_HEADER_PREFIX}2`,
			start: '2025-01-05',
			end: '2025-03-01',
			custom_class: 'gantt-group-header',
			filePath: '',
		});
	});

	it('escapes the group label', () => {
		const header = createGroupHeaderBar('R&D', 0, [note('2025-01-01', '2025-01-02')])!;
		expect(header).toMatchObject({ name: 'R&amp;D', label: 'R&D' });
	});
});

describe('isDependencyName', () => {
	// The dependencies property lists the notes this one waits for.
	it.each(['depends-on', 'dependencies', 'dependsOn', 'after', 'prerequisites', 'requires', 'blocked-by', 'blockedBy', 'blockers'])(
		'detects %s, which lists what the note waits for',
		(name) => {
			expect(isDependencyName(name)).toBe(true);
		},
	);

	it.each(['blocks', 'blocking', 'status', 'related'])(
		'does not detect %s',
		(name) => {
			expect(isDependencyName(name)).toBe(false);
		},
	);
});
