import { describe, expect, it } from 'vitest';
import { formatDateForFrontmatter, formatDateForGantt, parseObsidianDate } from '../src/date-utils';

describe('parseObsidianDate', () => {
	it('reads a date-only string as local midnight', () => {
		expect(parseObsidianDate('2025-03-30')).toEqual(new Date(2025, 2, 30));
	});

	it('reads a datetime with a space separator', () => {
		expect(parseObsidianDate('2025-03-30 14:05')).toEqual(new Date(2025, 2, 30, 14, 5));
	});

	it('reads an ISO datetime', () => {
		expect(parseObsidianDate('2025-03-30T14:05:09')).toEqual(new Date(2025, 2, 30, 14, 5, 9));
	});

	it('ignores surrounding spaces', () => {
		expect(parseObsidianDate('  2025-03-30 ')).toEqual(new Date(2025, 2, 30));
	});

	it('reads a timestamp in milliseconds', () => {
		const ms = new Date(2025, 0, 2).getTime();
		expect(parseObsidianDate(ms)).toEqual(new Date(2025, 0, 2));
	});

	it('passes a valid Date through', () => {
		const date = new Date(2025, 0, 2);
		expect(parseObsidianDate(date)).toBe(date);
	});

	it.each([
		['null', null],
		['undefined', undefined],
		['an empty string', ''],
		['blank text', '   '],
		['text that is no date', 'next week'],
		['an invalid Date', new Date('nope')],
		['a boolean', true],
		['a list', ['2025-01-01']],
	])('returns null for %s', (_, value) => {
		expect(parseObsidianDate(value)).toBeNull();
	});
});

describe('formatDateForGantt', () => {
	it('formats as YYYY-MM-DD with zero padding', () => {
		expect(formatDateForGantt(new Date(2025, 0, 5, 23, 59))).toBe('2025-01-05');
	});
});

describe('formatDateForFrontmatter', () => {
	it('writes a date only by default', () => {
		expect(formatDateForFrontmatter(new Date(2025, 0, 5, 8, 3, 9))).toBe('2025-01-05');
	});

	it('writes a local datetime when the time is included', () => {
		expect(formatDateForFrontmatter(new Date(2025, 0, 5, 8, 3, 9), true)).toBe('2025-01-05T08:03:09');
	});

	it('round-trips through parseObsidianDate', () => {
		const date = new Date(2025, 9, 26, 2, 30);
		expect(parseObsidianDate(formatDateForFrontmatter(date, true))).toEqual(date);
	});
});
