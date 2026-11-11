import { describe, expect, it } from 'vitest';
import { chartAt, DAY_VIEW, MONTH_VIEW, WEEK_VIEW } from './support/frappe';
import {
	MAX_PX_PER_DAY,
	MIN_PX_PER_DAY,
	VIEW_MODE_ZOOM,
	ZoomController,
	clampZoom,
	withCachedDateFormats,
	xForDate,
} from '../src/zoom';

const controllerAt = (pxPerDay: number) => new ZoomController(pxPerDay, () => null, () => {}, () => {});

describe('clampZoom', () => {
	it('keeps a zoom inside the range', () => {
		expect(clampZoom(10)).toBe(10);
	});

	it('limits zooming out', () => {
		expect(clampZoom(0.001)).toBe(MIN_PX_PER_DAY);
	});

	it('limits zooming in', () => {
		expect(clampZoom(10_000)).toBe(MAX_PX_PER_DAY);
	});
});

describe('zoom bands', () => {
	it.each([
		[0.5, 'Year', 365],
		[1, 'Month', 30],
		[3.9, 'Month', 30],
		[4, 'Week', 7],
		[21.9, 'Week', 7],
		[22, 'Day', 1],
		[80, 'Half Day', 0.5],
		[200, 'Quarter Day', 0.25],
	])('at %s px/day shows %s columns of %s days', (pxPerDay, mode, days) => {
		const options = controllerAt(pxPerDay).ganttOptions();
		expect(options.view_mode).toBe(mode);
		expect(options.column_width).toBeCloseTo(pxPerDay * days);
	});

	it('lists the current mode first, since Frappe starts in the first one', () => {
		expect(controllerAt(VIEW_MODE_ZOOM.Month).ganttOptions().view_modes[0].name).toBe('Month');
	});

	it('shades weekends from Week zoom on', () => {
		expect(controllerAt(4).ganttOptions().holidays).not.toBeNull();
	});

	it('does not shade weekends below Week zoom', () => {
		expect(controllerAt(3.9).ganttOptions().holidays).toBeNull();
	});

	it.each(Object.entries(VIEW_MODE_ZOOM))('the %s preset lands in its own band', (mode, pxPerDay) => {
		expect(controllerAt(pxPerDay).ganttOptions().view_mode).toBe(mode);
	});
});

describe('ZoomController without a chart', () => {
	it('clamps the initial zoom', () => {
		expect(controllerAt(0).pxPerDay).toBe(MIN_PX_PER_DAY);
	});

	it('zooms by a factor', () => {
		const zoom = controllerAt(20);
		zoom.zoomBy(1.5);
		expect(zoom.pxPerDay).toBe(30);
	});

	it('zooms to a level, clamped', () => {
		const zoom = controllerAt(20);
		zoom.zoomTo(1e6);
		expect(zoom.pxPerDay).toBe(MAX_PX_PER_DAY);
	});
});

describe('xForDate', () => {
	const start = new Date(2025, 0, 1);

	it('is uniform per day in Day view', () => {
		expect(xForDate(chartAt(start, DAY_VIEW), new Date(2025, 0, 11))).toBe(10 * DAY_VIEW.column_width);
	});

	it('counts whole days across a daylight saving change', () => {
		const chart = chartAt(new Date(2025, 2, 29), DAY_VIEW);
		expect(xForDate(chart, new Date(2025, 2, 31))).toBe(2 * DAY_VIEW.column_width);
	});

	it('spans a week per column in Week view', () => {
		expect(xForDate(chartAt(start, WEEK_VIEW), new Date(2025, 0, 15))).toBe(2 * WEEK_VIEW.column_width);
	});

	it('gives every month one column in Month view, whatever its length', () => {
		const chart = chartAt(start, MONTH_VIEW);
		const columnOf = (month: number) => xForDate(chart, new Date(2025, month, 1));
		expect(columnOf(2) - columnOf(1)).toBeCloseTo(MONTH_VIEW.column_width); // February
		expect(columnOf(3) - columnOf(2)).toBeCloseTo(MONTH_VIEW.column_width); // March
	});

	it('places day D of a month at D/31 of its column in Month view', () => {
		const chart = chartAt(start, MONTH_VIEW);
		const febFirst = xForDate(chart, new Date(2025, 1, 1));
		expect(xForDate(chart, new Date(2025, 1, 16)) - febFirst).toBeCloseTo((15 / 31) * MONTH_VIEW.column_width);
	});
});

describe('withCachedDateFormats', () => {
	it('returns what the render returns', () => {
		expect(withCachedDateFormats(() => 42)).toBe(42);
	});

	it('shares formatters with the same options during the render', () => {
		const [a, b] = withCachedDateFormats(() => [
			new Intl.DateTimeFormat('en', { month: 'long' }),
			new Intl.DateTimeFormat('en', { month: 'long' }),
		]);
		expect(a).toBe(b);
	});

	it('creates separate formatters for different options', () => {
		const [a, b] = withCachedDateFormats(() => [
			new Intl.DateTimeFormat('en', { month: 'long' }),
			new Intl.DateTimeFormat('en', { month: 'short' }),
		]);
		expect(a).not.toBe(b);
	});

	it('restores Intl.DateTimeFormat after the render', () => {
		const original = Intl.DateTimeFormat;
		withCachedDateFormats(() => null);
		expect(Intl.DateTimeFormat).toBe(original);
	});

	it('restores Intl.DateTimeFormat when the render throws', () => {
		const original = Intl.DateTimeFormat;
		expect(() => withCachedDateFormats(() => {
			throw new Error('render failed');
		})).toThrow('render failed');
		expect(Intl.DateTimeFormat).toBe(original);
	});
});
