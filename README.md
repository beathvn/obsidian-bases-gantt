# Gantt for Bases

Turn your Obsidian notes into an interactive Gantt chart — drag to reschedule, track progress, visualize dependencies, and more.

Requires **Obsidian 1.13+**.

Based on [Bases Gantt](https://github.com/lhassa8/obsidian-bases-gantt) by Lars Tray. Gantt for Bases is a standalone plugin and doesn't need Bases Gantt installed.

![Gantt chart showing tasks with dependencies and color coding](screenshots/gantt-demo.png)

---

## Quick Start

### Step 1: Create some notes with date properties

Each note that should appear on the Gantt chart needs at least a **start date** in its frontmatter (the YAML block at the top of a note). An end date is optional.

For example, create a few notes in a folder:

**Research.md**
```yaml
---
start-date: 2026-03-01
end-date: 2026-03-07
status: Done
---
Research phase of the project.
```

**Design.md**
```yaml
---
start-date: 2026-03-08
end-date: 2026-03-14
status: In Progress
---
Design mockups and wireframes.
```

**Development.md**
```yaml
---
start-date: 2026-03-15
end-date: 2026-03-28
status: Not Started
depends-on: "[[Research]], [[Design]]"
---
Build the thing.
```

> **Tip:** You can add frontmatter to any note by typing `---` at the very first line, adding your properties, and closing with another `---`.

### Step 2: Open the folder as a Gantt chart

1. Right-click the folder containing your notes
2. Select **New base from folder** — this opens a structured view of all the notes inside
3. At the top of the view, find the **view type dropdown** (it will say "Table" by default)
4. Switch it to **Gantt**
5. Your notes should appear as bars on a timeline

That's it! The plugin automatically detects which properties are dates and maps them to the chart.

---

## Setting Up Your Notes

The Gantt chart reads frontmatter properties from your notes. Here's what it can use:

### Dates only

The chart works with **whole days**. Use plain dates like `2026-03-01`. A time of day (`2026-03-01 14:00`) is ignored when drawing, bars always start and end on day boundaries, and the finest zoom is one day per column. Dragging a bar writes the new dates back as plain `YYYY-MM-DD`, so a time stored in the property is dropped.

### Required

| Property | What it does | Example |
|----------|-------------|---------|
| **Start date** | When the task begins. Without this, the note won't appear on the chart. | `start-date: 2026-03-01` |

### Optional

| Property | What it does | Example |
|----------|-------------|---------|
| **End date** | When the task ends. If omitted, the bar is drawn with a default length (1 day, adjustable in the plugin settings). | `end-date: 2026-03-05` |
| **Progress** | Completion percentage (0–100). Enables the progress bar on the task. Can also be a formula, e.g. [computed from the note's tasks](#progress-from-task-counts). | `progress: 40` |
| **Dependencies** | Wiki-links to notes that must finish first. Shows arrows between bars. | `depends-on: "[[Design]]"` |
| **Status / Priority / etc.** | Any text property can be used to color-code the bars. | `status: In Progress` |
| **Label** | Override the displayed name (defaults to the file name). | `label: "Phase 1 Research"` |

### Property names are flexible

You don't have to use the exact names above. The plugin auto-detects properties by looking for common keywords:

- **Start date:** `start`, `begin`, `from`, `created`
- **End date:** `end`, `due`, `finish`, `deadline`, `until`
- **Progress:** `progress`, `percent`, `completion`, `complete`, `done` (number properties only)
- **Dependencies:** `depends`, `blocked` (as in `blocked-by`), `blocker`, `after`, `prerequisite`, `requires` (text or link properties only). Not `blocks`: see [Dependencies](#dependencies)
- **Color by:** `status`, `priority`, `type`, `category`, `phase`, `stage` (text properties only)

So `due-date`, `deadline`, `finish-date`, etc. all work as end dates without any configuration. Progress, dependencies and Color by are only guessed when the start date isn't set in the view settings either.

### Dependencies

To link tasks with dependency arrows, add a property with wiki-links to other notes:

```yaml
depends-on: "[[Task A]], [[Task B]]"
```

**The property always lists the notes this one waits for.** Here Task A and Task B have to come first, and the arrows run from them to this task. Put the link on the *later* task.

So a property that says the opposite, like `blocks: "[[Task C]]"` ("this task holds up Task C"), would draw its arrows backwards. That's why `blocks` is **not** picked up automatically. If you track your tasks that way, move the link to the later task as `depends-on` (or `blocked-by`) instead. If you pick a property like `blocks` yourself under **Dependencies** in the view settings, it is still read as "waits for".

You can also use plain comma-separated names (without wiki-link brackets), but wiki-links are recommended because Obsidian will keep them updated if you rename notes.

### One-day tasks

A task that starts and ends on the same day is drawn as a one-day bar:

```yaml
---
start-date: 2026-03-15
end-date: 2026-03-15
---
```

### Resuming a task later (optional)

You can ignore this unless you have tasks you started a while ago and are now picking up again.

Say a project began in January 2024, then sat untouched, and you plan to work on it again from November 2026. With only a start date, its bar would stretch across almost three years of nothing. Give the note a **planned start** instead:

```yaml
---
start-date: 2024-01-10
plannedStart: 2026-11-02
end-date: 2026-12-15
---
```

The bar now begins on 2 November 2026. The start date stays in the note as the record of when the project began, and a faint dotted line on the chart leads back to it. Hovering over the bar also shows "Started 10 Jan 2024".

- Dragging such a bar moves the **planned start**, not the start date. The Undo notice says so: *Moved "Project" (planned start)*.
- A property named `plannedStart` is picked up automatically. To use another one, set **Planned start** under **Advanced** in the view settings.
- The dotted line can be turned off with **Show original start** in the same group.

### Progress from task counts

Instead of typing a percentage, you can compute progress from the checkboxes in each note. One way is the [Task Count](https://github.com/anareaty/task-count) community plugin, which writes the number of tasks in a note into its properties, plus a Bases formula that turns them into a percentage.

1. Install and enable **Task Count**. By default it counts into the properties `tasks` (all tasks) and `tasks_completed` (checked ones); the names can be changed in its settings.
2. Add those properties to each note you want counted. Task Count only fills in notes that already have at least one of them:

   ```yaml
   ---
   start-date: 2026-04-09
   end-date: 2026-04-18
   tasks:
   tasks_completed:
   ---
   - [x] Set up the database
   - [ ] Write the API
   ```

   With automatic updates on (Task Count's default) the numbers follow as you check tasks off; otherwise run its **Update task count** command.
3. Add a formula to the base that calculates the percentage, here named `progress`. In the `.base` file it looks like this:

   ```yaml
   formulas:
     progress: if(tasks > 0, tasks_completed / tasks * 100, 0)
   ```

   The `if` keeps notes without any tasks at 0% instead of dividing by zero.
4. In the Gantt view's settings, turn on **Show progress** and set **Progress** to the formula `progress`.

The bars now fill up as you check off tasks. Progress computed by a formula is always read-only on the chart, so no handle appears; **Drag to set progress** only applies to a plain number property.

---

## Configuring the View

Click the **gear icon** in the view header to open the Gantt settings panel.

### Properties Section

If auto-detection picks the wrong properties (or you want to override it), you can manually assign each one:

- **Start date** — Which date property to use as the bar's start
- **End date** — Which date property to use as the bar's end
- **Label** — Which property to use as the bar's label (defaults to file name)
- **Dependencies** — Which property contains dependency links
- **Color by** — Which property to color-code bars by (e.g., `status` gives each status value a different color). If not set, a property like `status` or `priority` is picked automatically; without one, all bars use your theme's accent color.
- **Progress** — Which numeric property represents completion (only visible when "Show progress" is on)

### Zooming

Pinch on a trackpad, or hold `Ctrl`/`Cmd` and scroll, to zoom the timeline smoothly from single days out to years. The date under the pointer stays in place, and the header switches between day, week, month and year columns as you zoom. Zoom level and scroll position are remembered per view on each device, without touching the `.base` file.

### Display Section

- **Bar height** — How tall the task bars are (16–60 pixels)
- **Show progress** — Toggle the progress bar overlay on tasks. Turns on by itself when a progress property is detected and you haven't set the toggle yet
- **Show expected progress** — When progress is shown, adds a dashed line indicating where progress *should* be based on how much time has elapsed
- **Drag to set progress** — When progress is shown, lets you change it on the chart by dragging a handle or from the right-click menu (on by default). Only works when **Progress** is a plain number property in the notes, not a formula

### Advanced

Optional. Only needed for [tasks you pick up again later](#resuming-a-task-later-optional). Leave it alone otherwise.

- **Planned start** — Which date property holds the day you resume. When a note has one, its bar begins there, and dragging the bar moves it instead of the start date. Defaults to a property named `plannedStart`.
- **Show original start** — For bars that begin at a planned start, draw a faint dotted line back to the note's own start date (on by default; it only appears on those bars)

---

## Interacting with the Chart

### Drag a bar left/right
Reschedules the task — changes the start and end dates. The dates are written back to the note's frontmatter automatically. Only that task changes, unless you turn on **Move dependent tasks along** in the plugin settings: then every task that depends on it moves by the same amount, and those notes are rewritten too. Drags snap to whole days when the chart shows day columns, and to whole weeks when zoomed out further.

### Drag the left or right edge of a bar
Resizes the task — the right edge changes the end date, the left edge the start date. On a task without an end date, dragging the right edge sets one. A bar can't be made shorter than one day: an edge stops at the other one.

### Undo
Every drag shows a notice with an **Undo** button. The **Undo last change** command reverts the most recent drags too, up to 20 back. A drag that also moved dependent tasks is undone as one step.

### Click a bar
Opens the note in the current tab.

### Right-click a bar
Opens a context menu:
- **Open note** — open in current tab
- **Open in new tab** — open in a new tab
- **Set progress** — quickly set to 0%, 25%, 50%, 75%, or 100% (unless **Drag to set progress** is off)
- **Scroll to today** — jump the chart to today's date

### Right-click empty space
- **Create new task** — creates a new note with today's date
- **Scroll to today**

### Click an empty date column
Creates a new task starting on that date. Works from Week zoom inwards, where the day under the pointer is highlighted; at Month and Year zoom a day is too narrow to aim at.

### Today button
The **Today** button in the chart's corner scrolls to today's date.

### Hover over a bar
If enabled, shows a popup with:
- Date range and duration
- When the task started, if its bar begins at a planned start
- Progress bar (if enabled)
- Dependencies (names of linked tasks)
- The properties chosen under **Properties on hover** in the plugin settings
- A scrollable, read-only preview of the note's content (can be turned off in the plugin settings)

Everything about the popup is under **Hover** in the plugin settings, including **Show details on hover** to turn it off. Click the popup to open the note.

### Drag the progress handle
With **Show progress** on (and **Drag to set progress** not turned off), a small handle appears at the end of the progress fill. Drag it to change the completion percentage; the new value is written to the note and can be undone.

---

## Grouping Tasks

If you configure **grouping** in the view (e.g., group by `status`), the Gantt chart reflects this with **group headers** — visual section bars that span the full date range of their group's tasks.

---

## Plugin Settings

Under **Settings → Community plugins → Gantt for Bases**:

- **Move dependent tasks along** — Off by default, so dragging a task only changes that task. Turn on to shift every task that depends on it by the same amount too; those notes' dates are rewritten as well, and one Undo reverts them all.
- **Default length without end date** — How many days a task without an end date is drawn (default 1).
- **Hover** — Everything about the popup that appears when you rest on a bar lives here, not in the view:
  - **Show details on hover** — Turn the popup on or off (on by default).
  - **Properties on hover** — Note properties to show in it, separated by commas (e.g. `status, owner, priority`).
  - **Note preview on hover** — Show a preview of the note's content in it (on by default).
- **Value colors** — Give specific values of the view's **Color by** property a fixed color (e.g. `done` → green). Matching ignores case. Values not listed here get a color automatically, which they keep while the value is in use, so adding new values never recolors existing bars. Automatic colors skip any palette color that looks like one you fixed. Up to 32 values can have a fixed color.

---

## Command Palette

All commands are available via `Cmd/Ctrl + P`:

| Command | What it does |
|---------|-------------|
| **Gantt for Bases: Scroll to today** | Jumps the chart to today's date |
| **Gantt for Bases: Undo last change** | Reverts the most recent drag |
| **Gantt for Bases: Create new task** | Creates a new note with today's date pre-filled |
| **Gantt for Bases: Zoom in** / **Zoom out** | Zoom around the center of the chart |
| **Gantt for Bases: Day view** | Jump to day-level zoom |
| **Gantt for Bases: Week view** | Jump to week-level zoom |
| **Gantt for Bases: Month view** | Jump to month-level zoom |
| **Gantt for Bases: Year view** | Jump to year-level zoom |

---

## Complete Example

Here's a small project with all features in use. Create these notes in a folder, then right-click the folder, select **New base from folder**, and switch the view to **Gantt**.

**Planning.md**
```yaml
---
start-date: 2026-04-01
end-date: 2026-04-03
status: Done
progress: 100
---
Define project scope and requirements.
```

**Design.md**
```yaml
---
start-date: 2026-04-04
end-date: 2026-04-08
status: Done
progress: 100
depends-on: "[[Planning]]"
---
Create wireframes and mockups.
```

**Backend.md**
```yaml
---
start-date: 2026-04-09
end-date: 2026-04-18
status: In Progress
progress: 60
depends-on: "[[Design]]"
---
API and database implementation.
```

**Frontend.md**
```yaml
---
start-date: 2026-04-09
end-date: 2026-04-20
status: In Progress
progress: 30
depends-on: "[[Design]]"
---
Build the UI components.
```

**Launch.md**
```yaml
---
start-date: 2026-04-21
end-date: 2026-04-21
status: Not Started
progress: 0
depends-on: "[[Backend]], [[Frontend]]"
---
Ship it!
```

This will show:
- **Planning** and **Design** as completed bars
- **Backend** and **Frontend** running in parallel, both depending on Design
- **Launch** as a one-day bar at the end, depending on both Backend and Frontend
- Dependency arrows connecting them
- Color-coded bars if you set "Color by" to `status`

---

## Troubleshooting

### I don't see a "Gantt" option in the view selector
Make sure the plugin is enabled in **Settings > Community plugins**. Also make sure you're running Obsidian **1.13 or later**.

### My notes don't appear on the chart
- Make sure your notes have a **date property** in the frontmatter (e.g., `start-date: 2026-03-01`)
- Make sure the date is a valid format: `YYYY-MM-DD`
- Check that the correct property is selected in the gear icon settings

### The chart shows "Configure a start date property"
Open the view settings (gear icon) and select which property contains your start dates. This usually means auto-detection couldn't find a date property — make sure your notes have date values, not just text.

### Dates are off by one day
This can happen if date values include timezone information. Use the plain `YYYY-MM-DD` format (e.g., `2026-03-01`) without time components for best results.

### Dependency arrows point the wrong way
The dependencies property must list the notes **this one waits for**, so put it on the later task (`depends-on: "[[Earlier task]]"`). A property that lists what a note blocks, like `blocks`, reads backwards.

### Dependency arrows aren't showing
- Make sure the dependency property uses wiki-link syntax: `depends-on: "[[Other Note]]"`
- The linked note must also appear on the chart (it needs a start date)
- Check that "Dependencies" is set to the correct property in view settings

---

## Installation

### Community Plugins (Recommended)

1. Open **Settings > Community plugins > Browse**
2. Search for **Gantt for Bases**
3. Click **Install**, then **Enable**

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/beathvn/obsidian-bases-gantt/releases/latest)
2. Create a folder called `gantt-for-bases` inside your vault's `.obsidian/plugins/` directory
3. Place the three files in that folder
4. Enable the plugin in **Settings > Community plugins**

---

## Development

```bash
git clone https://github.com/beathvn/obsidian-bases-gantt
cd obsidian-bases-gantt
npm install
npm run dev    # watch mode with source maps
npm run build  # type check + production build
npm run lint   # ESLint with Obsidian's plugin rules
```

To build straight into a test vault, set `OBSIDIAN_VAULT_PLUGIN_DIR` to its `.obsidian/plugins/gantt-for-bases` folder. Releases: `npm version patch|minor|major` updates `manifest.json` and `versions.json`; pushing the tag builds the GitHub release.

How it works is documented in [docs/](docs/README.md): an architecture overview, plus one page per feature on what it does and how it is built.

---

## Credits

Built on [Bases Gantt](https://github.com/lhassa8/obsidian-bases-gantt) by Lars Tray, and on [Frappe Gantt](https://github.com/frappe/gantt).

## License

[MIT](LICENSE)
