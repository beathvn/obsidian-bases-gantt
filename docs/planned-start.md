# Planned start

For planning: a project started long ago and paused can get a **planned start**, the date work picks up again. Its bar then begins there instead of years in the past. The start date stays untouched, as the record of when it began.

## Behavior

| Note has | Bar begins at | Dragging moves |
|---|---|---|
| start only | start | start (as before) |
| planned start (± start) | planned start | planned start |

- **Popup:** "Started <date>" when the note also has a start date.
- **Show original start** (Display option, off by default): a faint dotted line from the start date to the bar.

## How

- **Property:** view option **Planned start**. If unset, a note property named `plannedStart` (case, `-`, `_` and spaces ignored) is used. It is excluded from start/end auto-detection.
- **Mapping** (`task-mapper.ts`): `startDate = plannedStart ?? start`. The task gets `startsPlanned` and `originalStart`.
- **Writing** (`on_date_change`): the start is written to the planned start property when `startsPlanned` is set.
- **Line** (`drawOriginalStart`, in `afterRender`): an SVG line from `xForDate(originalStart)` (clamped to the grid) to the bar's x, placed behind the bar in its group so it takes the bar's color.

End date, dependencies and ordering all use the bar's start, so they follow the planned start.
