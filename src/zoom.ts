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

/** Frappe's default weekend shading. Below Week zoom a day is a few pixels wide, so the shading is
 * just stripes — and Frappe draws one element per day, the bulk of a far-out render. */
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

/**
 * Per-chart copies of Frappe's view modes whose lower header labels shrink
 * with the column width. Labels must never be empty: Frappe skips empty ones,
 * and click-to-create maps a click to a label by column index.
 */
function createViewModes(getPxPerDay: () => number): FrappeViewMode[] {
	return [
		{ ...BASE_MODES.YEAR },
		{
			...BASE_MODES.MONTH,
			lower_text: (d, _ld, lang) =>
				monthName(d, lang, getPxPerDay() * 30 >= 80 ? 'long' : 'short'),
		},
		{
			...BASE_MODES.WEEK,
			lower_text: (d, ld, lang) => {
				const width = getPxPerDay() * 7;
				const week = getISOWeekNumber(d);
				if (width >= 130) return `W${week} · ${formatWeekRange(d, ld, lang)}`;
				if (width >= 80) return `W${week} · ${d.getDate()} ${monthName(d, lang, 'short')}`;
				if (width >= 40) return `W${week}`;
				return String(week);
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
	change_view_mode(mode?: string, maintain_pos?: boolean): void;
	hide_popup(): void;
	set_scroll_position(date: unknown): void;
	setup_gantt_dates(refresh?: boolean): void;
	setup_date_values(): void;
	setup_dates(refresh?: boolean): void;
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
const ganttProto = Gantt.prototype as unknown as FrappeInternals;
ganttProto.setup_dates = function (this: FrappeInternals, refresh?: boolean): void {
	this.setup_gantt_dates(refresh);
	if (!refresh) {
		const { column_width, step, unit } = this.config;
		const padMs = ((this.$container.clientWidth || 1000) / (column_width / (step * DAYS_PER_UNIT[unit]))) * DAY_MS;
		let first = Date.now();
		let last = first;
		if (this.tasks.length) {
			first = Math.min(...this.tasks.map((t) => t._start.getTime()));
			last = Math.max(...this.tasks.map((t) => t._end.getTime()));
		}
		const start = startOfUnit(new Date(first - padMs), unit);
		if (start < this.gantt_start) this.gantt_start = start;
		const end = new Date(last + padMs);
		if (end > this.gantt_end) this.gantt_end = end;
	}
	if (this.config.view_mode?.name === 'Week') {
		const diffToMonday = (this.gantt_start.getDay() + 6) % 7;
		if (diffToMonday > 0) {
			this.gantt_start.setDate(this.gantt_start.getDate() - diffToMonday);
		}
	}
	this.setup_date_values();
};

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

function xForDate(g: FrappeInternals, date: Date): number {
	const { column_width, step, unit } = g.config;
	return (unitsBetween(date, g.gantt_start, unit) / step) * column_width;
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
	const from = xForDate(g, start);
	const target = from + dx;
	const estimate = Math.round((dateForX(g, target).getTime() - dateForX(g, from).getTime()) / DAY_MS);
	let best = estimate;
	let bestError = Infinity;
	for (const offset of [0, -1, 1, -2, 2, -3, 3]) {
		const d = new Date(start);
		d.setDate(d.getDate() + estimate + offset);
		const error = Math.abs(xForDate(g, d) - target);
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

export class ZoomController {
	pxPerDay: number;
	private readonly viewModes: FrappeViewMode[];
	private pending: { pxPerDay: number; anchor: Date; anchorX: number } | null = null;
	private frame = 0;
	private settleTimer = 0;
	private static readonly SETTLE_MS = 400;

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
	 * Run a Frappe re-render (e.g. refresh with new tasks) without the view
	 * jumping: the date at the left edge stays at the left edge.
	 */
	rerenderInPlace(render: () => void): void {
		const gantt = this.getGantt();
		if (!gantt) return render();
		const g = internals(gantt);
		this.renderAnchored(g, render, dateForX(g, g.$container.scrollLeft), 0);
	}

	destroy(): void {
		cancelAnimationFrame(this.frame);
		window.clearTimeout(this.settleTimer);
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
		this.renderAnchored(g, () => g.change_view_mode(band.mode), p.anchor, p.anchorX);
		this.onRendered();

		window.clearTimeout(this.settleTimer);
		this.settleTimer = window.setTimeout(() => this.onSettled(this.pxPerDay), ZoomController.SETTLE_MS);
	}

	private renderAnchored(g: FrappeInternals, render: () => void, anchor: Date, anchorX: number): void {
		// Frappe's render() ends by smooth-scrolling to options.scroll_to;
		// suppress that so the scroll can be placed under the anchor instead.
		g.set_scroll_position = () => {};
		try {
			withCachedDateFormats(render);
		} finally {
			delete (g as unknown as Record<string, unknown>).set_scroll_position;
		}
		g.$container.scrollLeft = xForDate(g, anchor) - anchorX;
	}
}
