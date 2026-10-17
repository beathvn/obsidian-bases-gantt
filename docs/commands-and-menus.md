# Commands and menus

## Command palette

Registered in `main.ts`. Each one acts on the Gantt view in the active leaf, or on any open one (`getActiveGanttView()`, via `GanttChartView.instances`). They're only available while a Gantt view is open (`checkCallback`).

| Command | Calls |
|---|---|
| Scroll to today | `scrollToToday()` |
| Undo last change | `undoLastChange()` ([Dragging](dragging.md)) |
| Create new task | `createTaskAtToday()` |
| Zoom in / out | zoom by ×1.5 / ÷1.5 around the center |
| Day / Week / Month / Year view | zoom to that mode's preset (`VIEW_MODE_ZOOM`) |

## Mouse

| Action | Result |
|---|---|
| Click a bar | Open the note. Ignored if the mouse moved, which counts as a drag. |
| Right-click a bar | Open note · Open in new tab · Scroll to today |
| Right-click empty space | Create new task · Scroll to today |
| Click an empty date column | New note starting (and ending) on that date |

## Creating tasks

`createTaskAtToday()` and `createTaskAtDate()` create a note named "New task" through Bases (`createFileForView`), so it lands where the base expects new notes, with the start (and end, if configured) set in its frontmatter. Computed properties are never written.
