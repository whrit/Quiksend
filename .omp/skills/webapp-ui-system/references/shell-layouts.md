# Shell layouts and navigation

The shell is the first decision and the hardest to change later, because it determines where every future feature goes.

**Contents:** [choosing a shell](#choosing-a-shell) · [the four shells](#the-four-shells) · [navigation IA](#navigation-ia) · [top bar](#top-bar) · [filter bar](#filter-bar) · [responsive](#responsive)

---

## Choosing a shell

Two questions decide it:

1. **How many top-level product areas?** One or a few → sidebar. Five or more, each with its own sub-navigation → add an icon rail.
2. **Does the user need to inspect an item without leaving the list?** Yes → add a drawer. If inspection is the main activity rather than an aside, use a full detail route instead.

If the primary activity is arranging things in space rather than reading records, none of the above applies — use the canvas shell.

## The four shells

### Sidebar + main

```
┌────────────┬──────────────────────────────────┐
│ search     │ topbar: crumbs · status · actions│
│ GENERAL    ├──────────────────────────────────┤
│ · Activity │ tabs / filter bar                │
│ · Notes  12├──────────────────────────────────┤
│ RECORDS    │ panels                           │
│ ▸ Companies│                                  │
└────────────┴──────────────────────────────────┘
```

260px sidebar on `--surface-2` with a hairline right border. The default; most tools never need more.

### Rail + sidebar + main

```
┌──┬────────────┬───────────────────────────────┐
│▪ │ SEO        │ Dashboard                     │
│▪ │ Dashboard  │                               │
│▪ │ Site audit │ panels                        │
│▪ │ Position…  │                               │
│▪ │            │                               │
└──┴────────────┴───────────────────────────────┘
```

A 60px rail of circular icon buttons switching _product area_; the sidebar then shows that area's navigation and is titled with the area name. Two references use this, both for tools with many distinct capabilities.

The rail is a real cost — icon-only navigation is unlabelled navigation, so every button needs a tooltip and the icons must be genuinely distinguishable. Don't add it for four areas.

### Sidebar + main + drawer

```
┌────────────┬────────────────────────┬─────────┐
│ nav        │ table                  │ detail  │
│            │ ▸ selected row ────────│ ▪ Figma │
│            │                        │ fields  │
│            │                        │ [action]│
└────────────┴────────────────────────┴─────────┘
```

340px drawer, hairline left border, opening on row selection. The drawer holds the record's identity tile, name, one-line description, its key fields as label/value pairs, and one primary action. Keep the list visible and the selected row tinted so position is never lost.

Make the drawer dismissible with `Escape` and keep focus management honest — moving focus into the drawer on open, returning it to the row on close.

### Canvas + palette

```
┌──┬───────────────┬────────────────────────────┐
│▪ │ ACTIONS       │  ·  ·  ·  ·  ·  ·  ·  ·  · │
│▪ │ MESSAGES      │      ┌──────────┐          │
│▪ │ · Send email  │      │ ▪ Trigger│          │
│▪ │ DELAYS        │      └────┬─────┘          │
│▪ │ · Wait until  │           │                │
│▪ │ FLOW CONTROL  │      ┌────┴─────┐          │
│▪ │ · Branch      │      │ ▪ Wait   │          │
└──┴───────────────┴────────────────────────────┘
```

A palette panel with uppercase group labels and coloured-icon items, beside a dotted-grid canvas. The palette's item colours must match the node header colours they create — that correspondence is what makes the palette learnable.

Above the canvas: breadcrumb, a status pill (`Draft`), the artifact's name, and a segmented control for its views (`Overview / Workflow / Settings / Export`). An inspector panel on the right is optional; a drawer works too.

## Navigation IA

**Two to four groups, with real names.** The references use `General`, `Records`, `Collections`, `My task`, `Threads`, `Browse`. Groups named `Main`, `Other`, or `More` mean the grouping hasn't been decided — that's a design problem surfacing as a label.

**Order by frequency, not hierarchy.** What the user opens twenty times a day goes first, regardless of where it sits in the data model.

**Nest one level, rarely two.** A `Leads` group expanding to `People / Companies / Enrichment` is fine. Three levels means the shell is wrong — that's a rail's job.

**Counts on things that accumulate** (unread, unassigned, overdue) in `--ink-3`. A solid red badge only for genuinely time-sensitive attention. Counts on everything trains users to ignore all of them.

**System vs user-created.** Line icons for system navigation, and something visibly different — emoji, colour chips, user-chosen icons — for collections the user made. One reference does exactly this and it reads immediately.

**Search at the top of the sidebar**, styled as a chip rather than a full input, with a `⌘K` hint. Wire the shortcut; a visible hint that doesn't work is worse than no hint.

## Top bar

One row, 12px/18px padding, hairline bottom border on `--surface`:

```
crumbs: Records / [▪ Companies]   [Published]   ····   [Cancel] [Next]
```

- **Breadcrumb** with the current item as a bordered pill carrying its type icon. Ancestors are plain links.
- **Status pill** immediately after the breadcrumb when the object has state.
- **Actions right-aligned**, at most one primary. In a wizard, `Cancel` + `Next`; in a record, an overflow menu plus one primary.

Don't stack a second toolbar row unless the view genuinely needs both tabs and filters — and then the order is tabs, then filters, so the filter bar sits closest to the data it filters.

## Filter bar

Pill chips, 34px, each with an icon and a label. Active chips carry the value inline — `Budget: $850K–$1.2M`, not a separate "1 filter applied" indicator — plus an `✕` to clear.

Right-align a segmented control for time range (`Today / 7d / Custom`) when the view is time-scoped. Provide `Reset` and `Save filter` for anything with more than about four dimensions; a saved-filter dropdown is what turns a filter bar into a workflow.

For heavy filtering, use a dedicated left filter panel instead: a header with `Reset` and a `Save filters` button (disabled until dirty — a real detail from the references), then collapsible groups with grey group headers, then rows of `icon + label` divided by hairlines. `Hide filter` toggles it away and the toggle stays visible.

**Counter tabs** are a separate device from filters and worth using where the same records have meaningful partitions: `Total 212,212 · Net new 11,231 · Saved 123`, underline-active, count in the tab label. They're navigation between populations; filters narrow within one.

## Responsive

Product UI does not need to be beautiful at 380px, but it must not be broken.

- Rail and drawer collapse; the sidebar becomes a slide-over triggered from a top-bar button.
- Panel grids drop to one column.
- **Tables scroll horizontally with a sticky first column.** Do not reflow into stacked cards — comparison across rows is the only reason a table exists.
- Filter bars wrap; they don't scroll horizontally, since a hidden active filter is a correctness problem, not an aesthetic one.
- Canvas views get pinch-zoom and a fit-to-view control rather than a reflow.
