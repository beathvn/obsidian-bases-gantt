import Gantt from 'frappe-gantt';

// ── Continuous zoom ──
// The chart has one zoom value: pixels per day. Frappe Gantt only knows
// discrete view modes (Day, Week, …), so each zoom level maps to the view
// mode whose band it falls in, with column_width = pxPerDay × days-per-column.
// Because the scale is continuous across band boundaries, crossing one only
// swaps the grid lines and header labels — bars stay where they were.

const DAY_MS = 86_400_000;

/** Days per Frappe step unit — the same approximations Frappe uses for bar widths. */
export const DAYS_PER_UNIT: Record<string, number> = { hour: 1 / 24, day: 1, month: 30, year: 365 };

export const MIN_PX_PER_DAY = 0.12;
export const MAX_PX_PER_DAY = 320;

interface ZoomBand {
	mode: string;
	daysPerColumn: number;
	/** The band applies from here up to the next (finer) band's minimum. */
	minPxPerDay: number;
}

/** Coarse → fine. Comments give each band's column width range. */
const ZOOM_BANDS: ZoomBand[] = [
	{ mode: 'Year', daysPerColumn: 365, minPxPerDay: MIN_PX_PER_DAY }, // 44–365px
	{ mode: 'Month', daysPerColumn: 30, minPxPerDay: 1 }, // 30–120px
	{ mode: 'Week', daysPerColumn: 7, minPxPerDay: 4 }, // 28–154px
	{ mode: 'Day', daysPerColumn: 1, minPxPerDay: 22 }, // 22–80px
	{ mode: 'Half Day', daysPerColumn: 0.5, minPxPerDay: 80 }, // 40–80px
	{ mode: 'Quarter Day', daysPerColumn: 0.25, minPxPerDay: 160 }, // 40–80px
];

/** Zoom that reproduces each former fixed view mode (also used by the "… view" commands). */
export const VIEW_MODE_ZOOM: Record<string, number> = {
	'Quarter day': 180,
	'Quarter Day': 180,
	'Half day': 90,
	'Half Day': 90,
	Day: 45,
	Week: 20,
	Month: 3.5,
	Year: 0.35,
};

export function clampZoom(pxPerDay: number): number {
	return Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, pxPerDay));
}

/** Frappe's default weekend shading. Below Week zoom a day is a few pixels wide, so the shading
 * would just be stripes; it's off there (and so are day hover and click-to-create). */
const WEEKEND_SHADING: Record<string, string> = { 'var(--g-weekend-highlight-color)': 'weekend' };
function holidaysFor(pxPerDay: number): typeof WEEKEND_SHADING | null {
	return pxPerDay >= 4 ? WEEKEND_SHADING : null;
}

function bandFor(pxPerDay: number): ZoomBand {
	let band = ZOOM_BANDS[0];
	for (const b of ZOOM_BANDS) {
		if (pxPerDay >= b.minPxPerDay) band = b;
	}
	return band;
}

/** Drags move in whole days while the grid shows days (Day zoom and finer), otherwise in whole weeks. */
export function dragSnapDays(pxPerDay: number): number {
	return bandFor(pxPerDay).daysPerColumn <= 1 ? 1 : 7;
}

// ── View modes with width-aware labels ──

type LabelFn = (d: Date, ld: Date | null, lang: string) => string;
interface FrappeViewMode {
	name: string;
	lower_text?: string | LabelFn;
	[key: string]: unknown;
}

const BASE_MODES = (Gantt as unknown as { VIEW_MODE: Record<string, FrappeViewMode> }).VIEW_MODE;
const formatWeekRange = BASE_MODES.WEEK.lower_text as LabelFn;

function getISOWeekNumber(date: Date): number {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
	return Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
}

const monthFormats = new Map<string, Intl.DateTimeFormat>();
function monthName(d: Date, lang: string, style: 'long' | 'short'): string {
	const key = `${lang}|${style}`;
	let fmt = monthFormats.get(key);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat(lang, { month: style });
		monthFormats.set(key, fmt);
	}
	return fmt.format(d);
}

// Frappe's lower header labels are 12px and get 80% of the column; today's
// label is bold and sits in a padded pill, so measure for that, the widest case.
const LABEL_SHARE = 0.8;
const LABEL_PILL_PADDING = 12;
let measureCtx: CanvasRenderingContext2D | null = null;
/** Format chosen per label kind, column width and language: decided once per zoom level, not per column. */
const fittingFormats = new Map<string, number>();

/** Forget the chosen label formats, e.g. after the theme (and so maybe the font) changed. */
export function clearLabelFormats(): void {
	fittingFormats.clear();
}

/**
 * Index of the first (most detailed) label format that fits a column of
 * this width, judged by each format's widest sample, so every column at a
 * zoom level gets the same format. Else the last format. The samples (all
 * labels of a format that could be the widest) are
 * only built and measured on the first call for a width; reading the font
 * on every label would force a style recalculation per column mid-render.
 */
function fittingFormat(kind: string, columnWidth: number, lang: string, widestSamples: () => string[][]): number {
	const key = `${kind}|${columnWidth}|${lang}`;
	let index = fittingFormats.get(key);
	if (index === undefined) {
		const family = getComputedStyle(document.body).getPropertyValue('--font-interface').trim() || 'sans-serif';
		measureCtx ??= document.createElement('canvas').getContext('2d');
		const ctx = measureCtx;
		if (ctx) ctx.font = `700 12px ${family}`;
		const room = columnWidth * LABEL_SHARE - LABEL_PILL_PADDING;
		const samples = widestSamples();
		index = samples.findIndex((labels) => !ctx || labels.every((label) => ctx.measureText(label).width <= room));
		if (index < 0) index = samples.length - 1;
		// Continuous zoom makes a new width at every step; keep the map small.
		if (fittingFormats.size > 200) fittingFormats.clear();
		fittingFormats.set(key, index);
	}
	return index;
}

/** A week spanning two months, with the longest numbers: the widest week labels. */
const WIDE_WEEK = new Date(2026, 8, 28);

/**
 * Per-chart copies of Frappe's view modes whose lower header labels shrink
 * to what fits the column width (measured, so in any font and language). Labels must never be empty: Frappe skips empty ones,
 * and click-to-create maps a click to a label by column index.
 */
function createViewModes(getPxPerDay: () => number): FrappeViewMode[] {
	return [
		{ ...BASE_MODES.YEAR },
		{
			...BASE_MODES.MONTH,
			lower_text: (d, _ld, lang) => {
				// Every month name is a sample: the widest one decides.
				const names = (style: 'long' | 'short') =>
					Array.from({ length: 12 }, (_, m) => monthName(new Date(2026, m, 1), lang, style));
				const format = fittingFormat('month', getPxPerDay() * 30, lang, () => [names('long'), names('short')]);
				return monthName(d, lang, format === 0 ? 'long' : 'short');
			},
		},
		{
			...BASE_MODES.WEEK,
			lower_text: (d, ld, lang) => {
				const format = fittingFormat('week', getPxPerDay() * 7, lang, () => [
					[`W52 · ${formatWeekRange(WIDE_WEEK, null, lang)}`],
					[`W52 · 28 ${monthName(WIDE_WEEK, lang, 'short')}`],
					['W52'],
					['52'],
				]);
				const week = getISOWeekNumber(d);
				return [
					`W${week} · ${formatWeekRange(d, ld, lang)}`,
					`W${week} · ${d.getDate()} ${monthName(d, lang, 'short')}`,
					`W${week}`,
					String(week),
				][format];
			},
		},
		{ ...BASE_MODES.DAY },
		{ ...BASE_MODES.HALF_DAY },
		{ ...BASE_MODES.QUARTER_DAY },
	];
}

// ── Frappe internals used here ──

interface FrappeInternals {
	gantt_start: Date;
	gantt_end: Date;
	grid_height: number;
	layers?: { grid: SVGGElement };
	tasks: { _start: Date; _end: Date }[];
	config: { column_width: number; step: number; unit: string; header_height: number; view_mode?: { name?: string } };
	options: { column_width?: number | null; holidays?: Record<string, string> | null };
	$container: HTMLElement;
	/** Set once the user asks for today, so later re-renders keep it in range. */
	include_today?: boolean;
	change_view_mode(mode?: string, maintain_pos?: boolean): void;
	hide_popup(): void;
	set_scroll_position(date: unknown): void;
	setup_gantt_dates(refresh?: boolean): void;
	setup_date_values(): void;
	setup_dates(refresh?: boolean): void;
	highlight_holidays(): void;
	/** Grid range cut short at the start / end to MAX_COLUMNS (see setup_dates). */
	windowed?: { start: boolean; end: boolean };
	windowCenter?: Date;
	/** Frappe: null outside a drag, false/true from mousedown on a bar. */
	bar_being_dragged?: boolean | null;
	dates: Date[];
	$svg: SVGSVGElement;
}

function internals(gantt: Gantt): FrappeInternals {
	return gantt as unknown as FrappeInternals;
}

function startOfUnit(date: Date, unit: string): Date {
	if (unit === 'year') return new Date(date.getFullYear(), 0, 1);
	if (unit === 'month') return new Date(date.getFullYear(), date.getMonth(), 1);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Frappe computes the grid range once per view mode change: the task range
// plus a fixed per-mode padding (7 days in Day view, 2 years in Year view).
// At an arbitrary zoom that can leave the grid narrower than the viewport, or
// leave no room to keep the date under the cursor in place. Pad each side by
// at least one viewport width instead. Week columns are also rolled back to
// start on Monday (Frappe has no week-start option).
//
// The grid also never gets more than MAX_COLUMNS columns: at Day zoom and
// finer, projects spanning years would mean thousands of columns, each with
// header label, tick and highlight, rebuilt on every zoom frame. Then only a
// window around the visible date (renderCenter) is drawn, and it is moved
// along when scrolling gets close to its edges (ZoomController.extendWindow).
const MAX_COLUMNS = 800;

/** Date the next render's grid window is centered on (set around each render). */
let renderCenter: Date | null = null;

/**
 * While a zoom gesture is under way, the grid is cut to this many viewport
 * widths: each frame of the gesture redraws the chart, and drawing just
 * what's in view (plus a margin to pan into) keeps that cheap. Once the
 * gesture rests, the chart is drawn once more with the full window.
 */
const GESTURE_VIEWPORTS = 5;
let gestureWindow = false;

/** Run a render (or the chart's construction) with its grid window centered on `center`. */
export function withRenderCenter<T>(center: Date | null, render: () => T): T {
	renderCenter = center;
	try {
		return render();
	} finally {
		renderCenter = null;
	}
}

const ganttProto = Gantt.prototype as unknown as FrappeInternals;
ganttProto.setup_dates = function (this: FrappeInternals, refresh?: boolean): void {
	this.setup_gantt_dates(refresh);
	if (!refresh) {
		const { column_width, step, unit } = this.config;
		const msPerColumn = step * DAYS_PER_UNIT[unit] * DAY_MS;
		const padMs = ((this.$container.clientWidth || 1000) / column_width) * msPerColumn;
		let first = Date.now();
		let last = first;
		if (this.tasks.length) {
			first = Math.min(...this.tasks.map((t) => t._start.getTime()));
			last = Math.max(...this.tasks.map((t) => t._end.getTime()));
		}
		if (this.include_today) {
			first = Math.min(first, Date.now());
			last = Math.max(last, Date.now());
		}
		const start = startOfUnit(new Date(first - padMs), unit);
		if (start < this.gantt_start) this.gantt_start = start;
		const end = new Date(last + padMs);
		if (end > this.gantt_end) this.gantt_end = end;

		const viewportColumns = (this.$container.clientWidth || 1000) / column_width;
		const maxColumns = gestureWindow ? Math.min(MAX_COLUMNS, Math.ceil(GESTURE_VIEWPORTS * viewportColumns)) : MAX_COLUMNS;
		const windowMs = maxColumns * msPerColumn;
		this.windowed = { start: false, end: false };
		if (this.gantt_end.getTime() - this.gantt_start.getTime() > windowMs) {
			const center = (renderCenter ?? this.windowCenter ?? new Date()).getTime();
			this.windowCenter = new Date(center);
			const fullStart = this.gantt_start.getTime();
			const fullEnd = this.gantt_end.getTime();
			// Centered, but shifted to stay inside the full range.
			const to = Math.min(fullEnd, Math.max(fullStart, center - windowMs / 2) + windowMs);
			const from = Math.max(fullStart, to - windowMs);
			this.gantt_start = startOfUnit(new Date(from), unit);
			this.gantt_end = new Date(to);
			this.windowed = { start: this.gantt_start.getTime() > fullStart, end: to < fullEnd };
		}
	}
	if (this.config.view_mode?.name === 'Week') {
		const diffToMonday = (this.gantt_start.getDay() + 6) % 7;
		if (diffToMonday > 0) {
			this.gantt_start.setDate(this.gantt_start.getDate() - diffToMonday);
		}
	}
	this.setup_date_values();
};

// Frappe's highlight_holidays() draws one rect per day of the whole grid
// range (for the weekend shading, and as hover / click target), formatting
// each date on the way: with projects spanning years, thousands of elements
// and most of the render time at Week zoom and finer, so zooming stuttered.
// Instead: one rect per weekend, one transparent click target for the whole
// grid (Frappe maps a click to a date by x), and one hover highlight that
// follows the pointer from day to day.
ganttProto.highlight_holidays = function (this: FrappeInternals): void {
	const grid = this.layers?.grid;
	const holidays = (this as unknown as { options: { holidays?: Record<string, string> | null } }).options.holidays;
	if (!grid || !holidays) return;
	const color = Object.keys(holidays)[0];
	const top = this.config.header_height;
	const height = this.grid_height - top;
	const width = this.dates.length * this.config.column_width;
	if (height <= 0) return;

	const saturday = new Date(this.gantt_start.getFullYear(), this.gantt_start.getMonth(), this.gantt_start.getDate());
	saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7));
	for (const d = saturday; d <= this.gantt_end; d.setDate(d.getDate() + 7)) {
		const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2);
		const x = xForDateInternal(this, d);
		svgEl('rect', { class: 'holiday-highlight', x, y: top, width: xForDateInternal(this, monday) - x, height, style: `fill: ${color};` }, grid);
	}

	// Frappe listens for mousedown on .grid-column to report a date click.
	svgEl('rect', { class: 'grid-column gantt-click-target', x: 0, y: top, width, height }, grid);
	svgEl('rect', { class: 'gantt-day-hover', x: 0, y: top, width: 0, height }, grid);
	trackDayHover(this);
};

/**
 * Move the day hover highlight under the pointer, one listener per chart.
 * The rect is looked up each time: right after highlight_holidays() Frappe
 * appends to the grid layer with innerHTML +=, which recreates its elements.
 */
function trackDayHover(g: FrappeInternals): void {
	const state = g as unknown as { tracksDayHover?: boolean };
	if (state.tracksDayHover) return;
	state.tracksDayHover = true;
	const hoverRect = () => g.$svg.querySelector('.gantt-day-hover');
	g.$svg.addEventListener('mousemove', (evt) => {
		const rect = hoverRect();
		if (!rect) return;
		if (!(evt.target as Element).classList?.contains('gantt-click-target')) {
			rect.setAttribute('width', '0');
			return;
		}
		const x = evt.clientX - g.$svg.getBoundingClientRect().left;
		const at = dateForX(g, x);
		const day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
		const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
		const x0 = xForDateInternal(g, day);
		rect.setAttribute('x', String(x0));
		rect.setAttribute('width', String(xForDateInternal(g, next) - x0));
	});
	g.$svg.addEventListener('mouseleave', () => hoverRect()?.setAttribute('width', '0'));
}

/**
 * Construct a chart without Frappe's initial smooth scroll to
 * options.scroll_to, so a remembered position can be restored instead.
 */
export function withoutInitialScroll<T>(create: () => T): T {
	const original = ganttProto.set_scroll_position;
	ganttProto.set_scroll_position = () => {};
	try {
		return create();
	} finally {
		ganttProto.set_scroll_position = original;
	}
}

// ── Date ↔ x, mirroring Frappe's own mapping ──

/** Frappe's date_utils.diff (unrounded): months count day D of a month as D/31. */
function unitsBetween(a: Date, b: Date, unit: string): number {
	if (unit === 'month' || unit === 'year') {
		let months = (a.getFullYear() - b.getFullYear()) * 12 + a.getMonth() - b.getMonth() + a.getDate() / 31;
		if (a.getDate() < b.getDate()) months--;
		return unit === 'year' ? months / 12 : months;
	}
	const ms = a.getTime() - b.getTime() + (b.getTimezoneOffset() - a.getTimezoneOffset()) * 60000;
	return ms / (unit === 'hour' ? 3_600_000 : DAY_MS);
}

function xForDateInternal(g: FrappeInternals, date: Date): number {
	const { column_width, step, unit } = g.config;
	return (unitsBetween(date, g.gantt_start, unit) / step) * column_width;
}

/** Where Frappe draws a bar starting on `date`. */
export function xForDate(gantt: Gantt, date: Date): number {
	return xForDateInternal(internals(gantt), date);
}

function dateForX(g: FrappeInternals, x: number): Date {
	const { column_width, step, unit } = g.config;
	const units = (x / column_width) * step;
	const s = g.gantt_start;
	if (unit === 'month' || unit === 'year') {
		const months = unit === 'year' ? units * 12 : units;
		const whole = Math.floor(months);
		const dayOfMonth = Math.max(1, (months - whole) * 31);
		return new Date(new Date(s.getFullYear(), s.getMonth() + whole, 1).getTime() + (dayOfMonth - 1) * DAY_MS);
	}
	// Overflowing the ms field adds wall-clock time, like Frappe's DST-corrected diff.
	return new Date(s.getFullYear(), s.getMonth(), s.getDate(), s.getHours(), 0, 0, units * DAY_MS * DAYS_PER_UNIT[unit]);
}

// ── Quarter backdrop ──

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
	parent.appendChild(el);
	return el;
}

/**
 * In Month zoom, faintly shade every other calendar quarter and put a large
 * "Q1"–"Q4" label in each. Drawn at the end of Frappe's grid layer, so it
 * sits above the row backgrounds but below arrows and bars. Must run after
 * every Frappe render, which rebuilds the SVG.
 */
export function drawQuarterBackdrop(gantt: Gantt): void {
	const g = internals(gantt);
	const grid = g.layers?.grid;
	if (g.config.unit !== 'month' || !grid) return;

	const top = g.config.header_height;
	const height = g.grid_height - top;
	if (height <= 0) return;
	// gantt_start is the 1st of a month in Month zoom, so month boundaries
	// fall exactly on the column lines.
	const start = g.gantt_start;
	const columnsPerMonth = 1 / g.config.step;
	const xOfMonth = (d: Date): number =>
		((d.getFullYear() - start.getFullYear()) * 12 + d.getMonth() - start.getMonth()) *
		columnsPerMonth * g.config.column_width;

	const group = svgEl('g', { class: 'gantt-quarters' }, grid);
	let q = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
	while (q < g.gantt_end) {
		const next = new Date(q.getFullYear(), q.getMonth() + 3, 1);
		const x0 = Math.max(0, xOfMonth(q));
		const x1 = xOfMonth(next);
		const quarter = Math.floor(q.getMonth() / 3) + 1;
		if (quarter % 2 === 0) {
			svgEl('rect', { class: 'gantt-quarter-band', x: x0, y: top, width: x1 - x0, height }, group);
		}
		const fontSize = Math.max(18, Math.min(72, height * 0.5, (x1 - x0) * 0.4));
		const label = svgEl('text', {
			class: 'gantt-quarter-label',
			x: (x0 + x1) / 2,
			y: top + Math.min(height / 2, fontSize),
			'font-size': fontSize,
		}, group);
		label.textContent = `Q${quarter}`;
		q = next;
	}
}

/**
 * Whole days to shift a bar starting on `start` so that Frappe draws it
 * as close as possible to where it was moved by `dx` pixels. In Month and
 * Year zoom Frappe's mapping follows the calendar (day D of a month sits at
 * D/31 of its column, leaving small gaps at month ends), so this is not
 * simply dx / px-per-day: the nearest few days are tried against it.
 */
export function dayShiftForX(gantt: Gantt, start: Date, dx: number): number {
	const g = internals(gantt);
	const from = xForDateInternal(g, start);
	const target = from + dx;
	const estimate = Math.round((dateForX(g, target).getTime() - dateForX(g, from).getTime()) / DAY_MS);
	let best = estimate;
	let bestError = Infinity;
	for (const offset of [0, -1, 1, -2, 2, -3, 3]) {
		const d = new Date(start);
		d.setDate(d.getDate() + estimate + offset);
		const error = Math.abs(xForDateInternal(g, d) - target);
		if (error < bestError - 0.01) {
			best = estimate + offset;
			bestError = error;
		}
	}
	return best;
}

// ── Render speed ──

/**
 * Run a Frappe render with Intl.DateTimeFormat instances cached. Frappe's
 * date_utils.format() constructs two new formatters on every call, and a
 * render calls it several times per grid column — most of the time of a
 * re-render at fine zoom levels. Formatters are immutable, so sharing them
 * is safe; the global is only swapped for the duration of the synchronous
 * render and always restored.
 */
export function withCachedDateFormats<T>(render: () => T): T {
	const Original = Intl.DateTimeFormat;
	const cache = new Map<string, Intl.DateTimeFormat>();
	const Cached = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
		const key = JSON.stringify([locales, options]);
		let fmt = cache.get(key);
		if (!fmt) {
			fmt = new Original(locales, options);
			cache.set(key, fmt);
		}
		return fmt;
	} as unknown as typeof Intl.DateTimeFormat;
	Intl.DateTimeFormat = Cached;
	try {
		return render();
	} finally {
		Intl.DateTimeFormat = Original;
	}
}

// ── Controller ──

/** Wheel zoom factor: a mouse wheel notch steps by a fixed ratio, a trackpad pinch scales smoothly. */
function wheelZoomFactor(evt: WheelEvent): number {
	let dy = evt.deltaY;
	if (evt.deltaMode === WheelEvent.DOM_DELTA_LINE) dy *= 16;
	else if (evt.deltaMode === WheelEvent.DOM_DELTA_PAGE) dy *= 400;
	const isMouseNotch = Math.abs(dy) >= 50 && Number.isInteger(dy);
	if (isMouseNotch) return dy < 0 ? 1.25 : 1 / 1.25;
	return Math.pow(2, -Math.max(-50, Math.min(50, dy)) * 0.01);
}

function touchDistance(touches: TouchList): number {
	return Math.max(1, Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY));
}

export class ZoomController {
	pxPerDay: number;
	private readonly viewModes: FrappeViewMode[];
	private pending: { pxPerDay: number; anchor: Date; anchorX: number } | null = null;
	private frame = 0;
	private windowFrame = 0;
	private settleTimer = 0;
	private pinch: { distance: number; targets: EventTarget[] } | null = null;
	private static readonly SETTLE_MS = 400;
	/** No zoom event for this long ends a gesture (see GESTURE_VIEWPORTS). */
	private static readonly GESTURE_REST_MS = 150;
	private gestureTimer = 0;

	constructor(
		initialPxPerDay: number,
		private readonly getGantt: () => Gantt | null,
		/** After each zoom re-render (Frappe rebuilds the whole SVG). */
		private readonly onRendered: () => void,
		/** Once a zoom gesture has come to rest, e.g. to persist the level. */
		private readonly onSettled: (pxPerDay: number) => void,
	) {
		this.pxPerDay = clampZoom(initialPxPerDay);
		this.viewModes = createViewModes(() => this.pxPerDay);
	}

	/** Frappe options for constructing a chart at the current zoom. */
	ganttOptions(): { view_mode: string; view_modes: FrappeViewMode[]; column_width: number; holidays: Record<string, string> | null } {
		const band = bandFor(this.pxPerDay);
		// Frappe's constructor starts in the first listed mode, ignoring view_mode.
		const modes = [
			...this.viewModes.filter((m) => m.name === band.mode),
			...this.viewModes.filter((m) => m.name !== band.mode),
		];
		return {
			view_mode: band.mode,
			view_modes: modes,
			column_width: this.pxPerDay * band.daysPerColumn,
			holidays: holidaysFor(this.pxPerDay),
		};
	}

	/** Ctrl/Cmd + wheel, or a trackpad pinch (which arrives as a ctrl + wheel event). */
	handleWheel(evt: WheelEvent): void {
		if (!(evt.ctrlKey || evt.metaKey)) return;
		const gantt = this.getGantt();
		if (!gantt) return;
		evt.preventDefault();
		const rect = gantt.$container.getBoundingClientRect();
		this.zoomBy(wheelZoomFactor(evt), evt.clientX - rect.left);
	}

	/** Two-finger pinch on a touchscreen, which (unlike a trackpad pinch) fires no wheel events. */
	handleTouchStart(evt: TouchEvent): void {
		if (evt.touches.length !== 2 || !this.getGantt()) return;
		this.endPinch();
		// Each zoom re-render replaces the SVG elements under the fingers, and touch events keep
		// going to their now-detached start targets without bubbling, so listen on those directly.
		const targets = [...new Set(Array.from(evt.touches, (t) => t.target))];
		for (const t of targets) {
			t.addEventListener('touchmove', this.onPinchMove, { passive: false });
			t.addEventListener('touchend', this.onPinchEnd);
			t.addEventListener('touchcancel', this.onPinchEnd);
		}
		this.pinch = { distance: touchDistance(evt.touches), targets };
	}

	private readonly onPinchMove = (evt: Event): void => {
		const touches = (evt as TouchEvent).touches;
		const gantt = this.getGantt();
		if (!this.pinch || !gantt || touches.length !== 2) return;
		evt.preventDefault();
		const distance = touchDistance(touches);
		const rect = gantt.$container.getBoundingClientRect();
		const midX = (touches[0].clientX + touches[1].clientX) / 2 - rect.left;
		this.zoomBy(distance / this.pinch.distance, midX);
		this.pinch.distance = distance;
	};

	private readonly onPinchEnd = (evt: Event): void => {
		if ((evt as TouchEvent).touches.length < 2) this.endPinch();
	};

	private endPinch(): void {
		if (!this.pinch) return;
		for (const t of this.pinch.targets) {
			t.removeEventListener('touchmove', this.onPinchMove);
			t.removeEventListener('touchend', this.onPinchEnd);
			t.removeEventListener('touchcancel', this.onPinchEnd);
		}
		this.pinch = null;
	}

	/** Zoom by a factor, keeping the date at anchorX (container px, default: center) in place. */
	zoomBy(factor: number, anchorX?: number): void {
		const base = this.pending?.pxPerDay ?? this.pxPerDay;
		this.zoomTo(base * factor, anchorX);
	}

	zoomTo(pxPerDay: number, anchorX?: number): void {
		const gantt = this.getGantt();
		if (!gantt) {
			this.pxPerDay = clampZoom(pxPerDay);
			return;
		}
		const g = internals(gantt);
		// Keep the first anchor of a burst of events that land before the next
		// frame: the chart hasn't re-rendered yet, so later ones would map to
		// the same date anyway.
		if (!this.pending) {
			const x = anchorX ?? g.$container.clientWidth / 2;
			this.pending = { pxPerDay: this.pxPerDay, anchor: dateForX(g, g.$container.scrollLeft + x), anchorX: x };
		}
		this.pending.pxPerDay = clampZoom(pxPerDay);
		if (!this.frame) this.frame = requestAnimationFrame(() => this.flush());
	}

	/**
	 * Scroll today's column to the left edge, as Frappe's scroll_current does.
	 * That one can't be used: it re-parses today from a string like
	 * "2026-09-27 ", which WebKit (Obsidian on iOS) rejects as an Invalid Date,
	 * sending the chart to its first column. It also does nothing when today is
	 * outside the grid's date range, so widen the range to include it first.
	 */
	scrollToToday(): void {
		const gantt = this.getGantt();
		if (!gantt) return;
		const g = internals(gantt);
		const now = new Date();
		if (now < g.gantt_start || now > g.gantt_end) {
			g.include_today = true;
			g.hide_popup();
			this.renderAnchored(g, () => g.change_view_mode(bandFor(this.pxPerDay).mode), now, 0);
			this.onRendered();
		}
		const { column_width } = g.config;
		const columnStart = Math.floor(xForDateInternal(g, now) / column_width) * column_width;
		g.$container.scrollTo({ left: columnStart - column_width / 6, behavior: 'smooth' });
	}

	/**
	 * Run a Frappe re-render (e.g. refresh with new tasks) without the view
	 * jumping: the date at the left edge stays at the left edge.
	 */
	rerenderInPlace(render: () => void): void {
		const gantt = this.getGantt();
		if (!gantt) return render();
		const g = internals(gantt);
		this.renderAnchored(g, render, dateForX(g, g.$container.scrollLeft), 0);
	}

	/** The date at the chart's left edge, to restore the pan position later. */
	leftEdgeDate(): Date | null {
		const gantt = this.getGantt();
		if (!gantt) return null;
		const g = internals(gantt);
		return dateForX(g, g.$container.scrollLeft);
	}

	/** Scroll so that `date` sits at the left edge, without animation. */
	scrollLeftTo(date: Date): void {
		const gantt = this.getGantt();
		if (!gantt) return;
		const g = internals(gantt);
		g.$container.scrollLeft = xForDateInternal(g, date);
	}

	/**
	 * On scroll: when the grid is cut short (see MAX_COLUMNS) and the view
	 * gets within a viewport of a cut edge, redraw it centered on the view.
	 * Not during a bar drag, which a redraw would end.
	 */
	extendWindow(): void {
		const gantt = this.getGantt();
		// Mid-gesture the full window is drawn when the gesture rests anyway.
		if (!gantt || this.windowFrame || this.gestureTimer) return;
		const g = internals(gantt);
		const { scrollLeft, clientWidth, scrollWidth } = g.$container;
		const nearStart = g.windowed?.start && scrollLeft < clientWidth;
		const nearEnd = g.windowed?.end && scrollLeft + clientWidth > scrollWidth - clientWidth;
		if (!nearStart && !nearEnd) return;
		this.windowFrame = requestAnimationFrame(() => {
			this.windowFrame = 0;
			if (g.bar_being_dragged != null) return;
			this.renderAnchored(g, () => g.change_view_mode(bandFor(this.pxPerDay).mode), dateForX(g, g.$container.scrollLeft), 0);
			this.onRendered();
		});
	}

	destroy(): void {
		window.clearTimeout(this.gestureTimer);
		cancelAnimationFrame(this.windowFrame);
		cancelAnimationFrame(this.frame);
		window.clearTimeout(this.settleTimer);
		this.endPinch();
		this.frame = 0;
		this.pending = null;
	}

	private flush(): void {
		this.frame = 0;
		const p = this.pending;
		this.pending = null;
		const gantt = this.getGantt();
		if (!p || !gantt) return;
		if (p.pxPerDay === this.pxPerDay) return;

		const g = internals(gantt);
		this.pxPerDay = p.pxPerDay;
		const band = bandFor(p.pxPerDay);
		g.options.column_width = p.pxPerDay * band.daysPerColumn;
		g.options.holidays = holidaysFor(p.pxPerDay);
		g.hide_popup();
		gestureWindow = true;
		try {
			this.renderAnchored(g, () => g.change_view_mode(band.mode), p.anchor, p.anchorX);
		} finally {
			gestureWindow = false;
		}
		this.onRendered();

		// Once the gesture rests, draw the full window around the view.
		window.clearTimeout(this.gestureTimer);
		this.gestureTimer = window.setTimeout(() => {
			this.gestureTimer = 0;
			this.renderAnchored(g, () => g.change_view_mode(bandFor(this.pxPerDay).mode), dateForX(g, g.$container.scrollLeft), 0);
			this.onRendered();
		}, ZoomController.GESTURE_REST_MS);

		window.clearTimeout(this.settleTimer);
		this.settleTimer = window.setTimeout(() => this.onSettled(this.pxPerDay), ZoomController.SETTLE_MS);
	}

	private renderAnchored(g: FrappeInternals, render: () => void, anchor: Date, anchorX: number): void {
		// Frappe's render() ends by smooth-scrolling to options.scroll_to;
		// suppress that so the scroll can be placed under the anchor instead.
		g.set_scroll_position = () => {};
		// A cut-short grid is centered on the middle of the viewport after this render.
		const viewportMiddle = new Date(anchor.getTime() + ((g.$container.clientWidth / 2 - anchorX) / this.pxPerDay) * DAY_MS);
		try {
			withRenderCenter(viewportMiddle, () => withCachedDateFormats(render));
		} finally {
			delete (g as unknown as Record<string, unknown>).set_scroll_position;
		}
		g.$container.scrollLeft = xForDateInternal(g, anchor) - anchorX;
	}
}
