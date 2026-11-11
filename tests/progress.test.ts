import { describe, expect, it } from 'vitest';
import { anyColor, config, entry } from './support/entries';
import { mapEntriesToNotes } from '../src/note-mapper';

const progressOf = (value: string | number | null, overrides = {}) =>
	mapEntriesToNotes(
		[entry('A.md', { start: '2025-01-01', progress: value })],
		config({ showProgress: true, progressProperty: 'note.progress', ...overrides }),
		anyColor,
	)[0].progress;

describe('progress', () => {
	it('reads a number', () => {
		expect(progressOf(40)).toBe(40);
	});

	it('reads a numeric text value', () => {
		expect(progressOf('62.5')).toBe(62.5);
	});

	it('clamps values above 100', () => {
		expect(progressOf(150)).toBe(100);
	});

	it('clamps negative values to 0', () => {
		expect(progressOf(-5)).toBe(0);
	});

	it('clamps Infinity (a formula dividing by zero) to 100', () => {
		expect(progressOf(Infinity)).toBe(100);
	});

	it.each([
		['missing', null],
		['text', 'half'],
		['NaN', NaN],
	])('is 0 when the value is %s', (_, value) => {
		expect(progressOf(value)).toBe(0);
	});

	it('is 0 while Show progress is off', () => {
		expect(progressOf(40, { showProgress: false })).toBe(0);
	});

	it('is 0 without a progress property', () => {
		expect(progressOf(40, { progressProperty: null })).toBe(0);
	});
});
