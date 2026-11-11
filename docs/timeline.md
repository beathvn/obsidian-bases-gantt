# Timeline

What the chart draws around the bars: the date header, the grid's shading, today and where the chart opens. Most of it comes from Frappe; the plugin adjusts it to continuous [zoom](zoom.md) and to the Obsidian theme.

## Header labels

Frappe draws two header rows per view mode. The plugin replaces the lower row's labels of Month and Week view with ones that shrink to what fits the column (`createViewModes()` in `zoom.ts`):

| View | Labels, most detailed first |
|---|---|
| Month | full month name → short month name |
| Week | `W12 · 16 - 22` (Frappe's week range) → `W12 · 16 Mar` → `W12` → `12` |

- **Week numbers** are ISO 8601 (`getISOWeekNumber()`), and Week columns start on Monday (`setup_dates` patch).
- **Fitting:** `fittingFormat()` measures the widest possible label of each format in the theme's interface font and the chart's language, and picks the first that fits 80 % of the column. The choice is made once per zoom level, so all columns use the same format. It is forgotten on theme changes (`clearLabelFormats()`), since the font may have changed.
- Labels are never empty: Frappe skips empty ones, and click-to-create maps a click to a column by its label.
- **Scrolls with the grid:** Frappe makes the header sticky at `left: 0` as well as `top: 0`. The header is as wide as the grid, so that normally changes nothing, but if the scrollable area is even a few pixels wider, the header stays put for that many pixels of scrolling and is then offset from the grid. `gantt-overrides.css` keeps only the top pin (`left: auto`).
- Year and Day use Frappe's own labels.

## Grid shading

| What | When | How |
|---|---|---|
| Weekends | from Week zoom on (≥ 4 px/day) | one rect per weekend (`highlight_holidays` patch); below that a day is too narrow and it would just be stripes |
| Day under the pointer | from Week zoom on | one rect moved on `mousemove`; a click there creates a task ([Commands and menus](commands-and-menus.md)) |
| Quarters | Month zoom | every other calendar quarter faintly shaded, with a large `Q1`–`Q4` label (`drawQuarterBackdrop()`) |

The quarter backdrop is drawn at the end of Frappe's grid layer, above the row backgrounds and below arrows and bars. Frappe rebuilds the SVG on every render, so `afterRender()` draws it again each time.

## Today

- Frappe's today line and column highlight are kept, faded, with today's header label in bold. The line is an HTML element above the SVG, so it is made transparent to the pointer; otherwise bars crossing today couldn't be dragged.
- The **Today** button, the **Scroll to today** command and menu item all call `scrollToToday()`. It widens the grid to include today if needed (`include_today`, kept for later renders) and smoothly scrolls today's column to the left edge. Frappe's own `scroll_current()` is replaced because it fails on iOS.

## Where the chart opens

1. With saved state for this view on this device: the saved zoom and left-edge date ([Zoom → Persistence](zoom.md#persistence)).
2. Otherwise: Day zoom, scrolled to the earliest task, or to today when no task has a date.

Data updates (a drag's write, a note edited elsewhere) refresh the chart in place and keep the date at the left edge (`ZoomController.rerenderInPlace()`). Frappe's own `refresh()` would jump back to the earliest task.

## Theme

`styles/obsidian-theme.css` maps Frappe's `--g-*` variables to Obsidian's theme variables (accent, borders, backgrounds, text), so the chart follows light and dark mode and community themes. Bars without a [color](colors.md) use the accent color.
