# Component library

Anatomy and judgement calls for each primitive. Implementations are in `assets/ui-kit.css`; this file covers _when_ and _why_, which is the part that doesn't fit in a stylesheet.

**Contents:** [icon tiles](#icon-tiles) · [pills and badges](#pills-and-badges) · [buttons](#buttons) · [tables](#tables) · [forms](#forms) · [option cards](#option-cards) · [navigation items](#navigation-items) · [metric cards](#metric-cards) · [panels](#panels) · [canvas nodes](#canvas-nodes) · [charts](#charts) · [overlays](#overlays)

---

## Icon tiles

The signature atom. A rounded square with radius ≈30% of its side, holding one glyph at ~58% of the tile.

| Size      | Use                                                                                       |
| --------- | ----------------------------------------------------------------------------------------- |
| 20px `xs` | Inline in table cells and nav sub-items, often with no glyph at all — just a colour chip  |
| 26px `sm` | Panel headers, metric card identifiers, toast icons                                       |
| 34px `md` | Option cards, node headers, list item avatars                                             |
| 56px `lg` | Page or wizard step identity, empty-state illustration; the only size that takes a shadow |

**Solid vs tinted.** Solid fill (white glyph) for identity and emphasis. Tinted fill (`--p-tint-2` background, coloured glyph) for repeated inline metadata where solid would be too loud. A table with forty solid tiles is a Christmas tree; use `xs` colour chips or tinted tiles there.

**When the tile has no glyph.** Perfectly legitimate. One reference uses bare coloured squares beside nav items to encode task state. If the concept has no obvious glyph, a colour chip is better than a forced metaphor.

**Emoji as tiles.** One reference uses emoji for _user-created_ collections while keeping line icons for system navigation. That distinction is worth stealing — it signals "you made this" — but never mix emoji into system chrome.

## Pills and badges

Pills are metadata. Buttons are actions. Keep the shapes distinct: pills fully rounded, buttons at `--r` (8px).

- **Status** — `Published`, `Draft`, `Archived`. Semantic tint + matching text.
- **Tag** — a `#` prefix and a categorical tint. Tint by category, and keep the mapping stable across the whole app.
- **Delta** — `+18.4%` / `−12.5%`, positive or negative tint, always adjacent to the value it modifies. Include the sign.
- **Count** — in a nav item, plain `--ink-3` text, right-aligned. As a notification badge, solid `--neg` with white text — reserve that for things genuinely requiring attention.
- **Filter chip** — 34px tall, hairline border, icon + label; when active, primary tint plus border and an `✕` to clear.

Text inside a tint must be a darkened version of the tint's hue, not the pure hue — pure `#30CC83` on `#E1FAEA` fails contrast. `color-mix(in srgb, var(--pos) 70%, var(--ink))` is a reliable derivation.

## Buttons

Four variants and no more:

- **Primary** — accent fill. One per view, on the single most likely action.
- **Secondary** — surface fill, hairline border. The workhorse.
- **Ghost** — transparent, tinted on hover. Toolbars and icon buttons.
- **Contrast** — near-black regardless of the accent, for the one most consequential action in a view (`Compare`, `Publish`, `Delete`). One reference uses this to make a comparison action outrank the accent-coloured chrome around it. Effective precisely because it's rare.

Heights 30 / 36 / 42. Destructive actions are secondary-shaped with `--neg` text, escalating to a solid `--neg` fill only inside a confirmation dialog — a red button in normal chrome gets clicked by accident.

## Tables

The most common view and the easiest to get wrong.

**Header.** 44px, `--surface-2`, sticky, 13px medium in `--ink-2`, each column prefixed with a small grey icon naming its data type. Those icons are load-bearing: they let a user identify a column at a glance in a wide table.

**Rows.** 52px default. Cell content is a flex row with 9px gaps, which lets a logo, a tile, or a status icon sit beside text without ad-hoc margins.

**Vertical rules.** The references keep faint vertical dividers (`--line-soft`) between columns. In a wide dense table this genuinely helps; in a table of five columns it's noise. Judge by column count — roughly six or more, keep them.

**Absent values.** Named, in `--ink-3`: `No contact`, `Unassigned`, `Never`. Blank cells look broken.

**Status columns.** A coloured icon plus a text label, not colour alone — colour-only status fails for colourblind users and prints badly. One reference runs four strength levels this way, each with a distinct glyph _and_ a distinct hue, so either channel is sufficient.

**Selection.** Checkbox column at 44px, and a selected row gets both a checked box and a primary tint. When any row is selected, replace the panel header actions with a bulk action bar — showing per-row and bulk affordances simultaneously is confusing.

**Width.** Let wide tables scroll horizontally with the first column sticky. Reflowing a table into stacked cards on narrow screens destroys comparison, which is the only reason to use a table.

## Forms

**Field anatomy.** Bold 13px label, `*` in `--neg` when required, 40px input, 12px help text beneath. Help text explains consequence, not format — the input's placeholder handles format.

**Character counters** bottom-right in `--ink-3`, tabular. Only when a limit genuinely exists.

**Progressive disclosure.** Long forms collapse into `<details>` sections with a chevron, a bold summary, and one line of description under the summary explaining what's inside. One reference stacks four of these — `Product Format`, `Set Your Pricing` — each with a one-line preview. Keep the first section open.

**Validation.** Inline, beneath the field, on blur rather than on keystroke. Never rely on red border alone; pair it with text.

**Wizards.** A vertical stepper on the left with the current step's form on the right. Each step card carries a small tile, an uppercase label, a bold title, and one line of description. Connect steps with a vertical line and small node circles, and mark the active step with an accent border plus a tinted header. Show all steps at once — a hidden step count makes people abandon.

## Option cards

A radio group rendered as tiles. Each card needs three things: a coloured `md` tile, a bold label, and **one line describing the consequence of choosing it** — "Customers download it directly" rather than "File type." The consequence line is what makes these better than a radio list.

Selected state gets the primary border plus a 1px ring, and a checkbox in the top-right corner. Use `role="radio"` with `aria-checked`; a `<button>` styled as a card without ARIA is invisible to screen readers.

Three to four options. Beyond that use a select.

## Navigation items

38px tall, 10px gap, 18px line icon, medium weight, `--ink-2`. Active state is a primary tint with primary text _and_ a primary icon.

**Group labels** are 11px uppercase, tracked `0.07em`, in `--ink-3`. Use two to four groups with real names — `General`, `Records`, `Collections`, `My task`. Groups labelled `Main` or `Other` mean the IA isn't finished.

**The left marker bar** (a 2px accent rule at the item's left edge) is an alternative to the tint, not an addition — unless the nav nests two levels deep, where the marker helps hold the parent-child relationship that a tint alone loses.

**Counts** right-aligned in `--ink-3`. **Nested items** indent 22px and can carry an `xs` colour chip instead of a full icon.

## Metric cards

```
[sm tile]  Card title                        ···
54.72%  (+21.6%)
Avg. engagement rate
[chart]
```

Header with tile, title, and an overflow menu. Then the value/delta/label triple. Then the chart. Consistency here matters more than variety: when six metric cards share one internal layout, the user learns it once.

Two sub-patterns: a **big single value** as above, or an **inline metric row** — `Contracts 186 (+18.4%)   Active deals 42 (+9.6%)` — for cards carrying two related figures. Don't mix both inside one card.

## Panels

A titled region with a hairline border and `--r-lg` radius. The header carries a tile, a name, and optional right-aligned actions.

The important choice is **hairline grid vs gapped cards.** Cells that are variations of one thing (six metrics of the same system) belong in a continuous hairline grid — it says "these are comparable." Genuinely independent modules belong in separate panels with margin between them. The reference dashboards use hairline grids almost exclusively, which is a large part of why they read as instruments.

## Canvas nodes

A flow node is a tinted header carrying the node's _type colour_ plus a neutral body carrying its content.

- **Header** — 9px/12px padding, coloured icon and title on a ~14%-opacity wash of the same hue, with an optional right-aligned kind badge (`IF`, `AND`).
- **Body** — bold title (the configured value: `Monday at 9:00 AM`) and one grey line of explanation.
- **Unconfigured state** — say what's missing in the body: `Branch on 0 conditions` / `Add a condition, e.g. Opened email = true`. Never render an empty node.
- **Connectors** inherit the _source_ node's colour, with a small dot at each endpoint. A dark reference does this so a long flow can be read by colour alone.
- **Branches** split with small `TRUE` / `FALSE` pills on each leg.

Node width around 300px, and keep every node the same width — varying widths make a flow look accidental.

## Charts

For static or layout-stage work, the kit's CSS charts are enough: vertical bars with one highlighted, horizontal rounded bars with inline percentages, and inline SVG sparklines with an area fill. Reach for a real charting library when interaction, axes, or responsive scales matter.

**Series colour.** Use a single-hue ramp (`--p` → `--p-400` → `--p-300` → `--p-tint`) for ordered or stacked series, and the categorical set only for genuinely unrelated categories. One reference stacks three indigo steps, which reads instantly as "parts of one whole" — categorical hues there would imply the segments are unrelated.

**Highlighting.** One bar in full accent against the rest in `--p-tint-2`, with a dark tooltip pinned to it. Far more legible than a legend.

**Deltas near charts** always as pills, never as bare coloured text.

## Overlays

**Drawer** (340px, right, hairline left border) for inspecting a record without leaving the list — the correct default for triage workflows. **Modal** only for genuinely blocking decisions and destructive confirmations. **Popover** for filter builders and column pickers. **Toast** bottom-right, with a semantic tile, a bold one-line summary, and a specific remedy: `Import failed on row 42` / `Column "Domain" was empty. Fix the row and re-upload.`

Toasts naming a row, a field, and an action are the difference between an app that feels maintained and one that feels shipped.
