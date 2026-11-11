import type Gantt from 'frappe-gantt';

/**
 * The part of a rendered Frappe chart that its date ↔ x mapping reads: the
 * grid's first date and the current view mode's column width and step.
 */
export function chartAt(
	ganttStart: Date,
	mode: { column_width: number; step: number; unit: 'hour' | 'day' | 'month' | 'year' },
): Gantt {
	return { gantt_start: ganttStart, config: mode } as unknown as Gantt;
}

export const DAY_VIEW = { column_width: 45, step: 1, unit: 'day' } as const;
export const WEEK_VIEW = { column_width: 140, step: 7, unit: 'day' } as const;
export const MONTH_VIEW = { column_width: 105, step: 1, unit: 'month' } as const;
export const YEAR_VIEW = { column_width: 128, step: 1, unit: 'year' } as const;
