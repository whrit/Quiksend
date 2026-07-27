---
name: webapp-ui-system
description: Design and build product interfaces for web applications — dashboards, data tables, record detail views, builders and flow canvases, settings, wizards, filter panels, admin consoles — in a dense, modern SaaS idiom built on colour-coded rounded-square icon tiles, hairline-divided panels, pill-based metadata, and a strict semantic colour contract. Ships a themeable CSS component kit covering light and dark. Use this skill whenever the user asks for app UI, a dashboard, an admin panel, a data table, a CRM or console screen, an internal tool, a workflow or automation builder, a settings page, or any signed-in product interface — and especially when they supply screenshots of app UIs as reference, mention shadcn/Linear/Notion/Attio-style interfaces, or want an existing app screen to look professionally designed rather than bootstrapped. Applies to any application domain, not just the ones in the reference material. Do not use this for marketing or landing pages; those are a different problem.
---

# Web app UI system

Product interfaces fail differently from marketing pages. A marketing page fails by being generic; an app screen fails by being _undifferentiated_ — every row, label, and status rendered at the same visual weight, so the user has to read everything to find anything. The reference material solves this with one consistent move: **encode meaning in a small vocabulary of visual atoms, then use them ruthlessly consistently.**

Across seven reference apps — a product wizard, a CRM table, a map search tool, a support analytics console, a dark automation builder, a lead-gen filter UI, a dark SEO dashboard — the domains have nothing in common, but the vocabulary is nearly identical. That vocabulary is what this skill encodes, and it transfers to any application.

## The atomic units

Five elements do almost all the work. Learn these and the rest is composition.

**1. The colour-coded icon tile.** A rounded square (radius ≈30% of its size) holding one glyph. It appears in every single reference screenshot — marking nav items, heading panels, identifying metric cards, labelling option cards, typing flow nodes, indicating task states. Solid fill for identity and emphasis; tinted fill for inline metadata. Sizes 20 / 26 / 34 / 56px. This is the single most recognizable element of the idiom.

**2. The pill.** Fully rounded, 24px tall, for anything that is _metadata rather than action_: status (`Published`, `Draft`), tags (`# Productivity`), deltas (`+18.4%`), counts, filter chips, keyboard hints. Buttons stay rectangular so the two families never blur.

**3. The hairline-divided panel.** Named regions whose internal cells are separated by 1px rules rather than gaps. A gapped card grid reads as a website; a continuous hairline grid reads as an instrument. This is the difference most responsible for the reference dashboards looking like tools.

**4. The value / delta / label triple.** Every metric is a large tabular number, a coloured delta pill beside it, and a quiet label beneath. Always that order, always all three.

**5. The dotted-grid canvas.** For anything spatial — builders, flows, maps. Establishes that objects have positions rather than being stacked.

## Non-negotiables

1. **Colour means something, always.** Green is positive, amber is caution or in-between, red is negative, the primary is interactive-or-active, and the categorical set encodes _type_. Never pick a colour because a cell looked empty. A user who learns that green means "strong" in one column must find it means the same everywhere.

2. **One primary, three semantic, at most six categorical.** Beyond six categorical hues nobody can hold the mapping, and the interface becomes decorative.

3. **Every empty cell says what is absent.** `No contact`, `Unassigned`, `—` in `--ink-3`. A blank cell reads as a rendering bug.

4. **Selection is unmistakable and redundant.** Checkbox filled _and_ row tinted, or border _and_ ring. One signal alone gets missed.

5. **Icons are one family at one stroke weight.** Monochrome grey in navigation; coloured only when carrying semantic meaning. Mixing icon sets is instantly visible.

6. **Numbers are tabular.** `font-variant-numeric: tabular-nums` on every metric, count, and table figure, or columns jitter.

7. **Design the empty, loading, and error states in the same pass.** They're the majority of what a user sees on day one, and retrofitting them always looks retrofitted.

## Mapping any app onto this system

The reference apps are a CRM, a wizard, a map tool, two dashboards, and two builders. To apply the vocabulary to something else, run this procedure rather than looking for the closest matching screenshot:

1. **Name the primary object** the user manipulates — a company, a product, a workflow, a property, a keyword. Almost every screen is a list of these, one of these, or a canvas of these.
2. **Enumerate the view types needed.** Usually a subset of: list/table, detail, canvas, dashboard, form/wizard, settings. Each has a canonical construction in `references/components.md`.
3. **Pick a shell** from the four archetypes below, based on navigation breadth and whether the user needs a detail view alongside the list.
4. **Write the colour contract before building.** Which states are positive/caution/negative in _this_ domain, and what the categorical hues type. Put it in a comment at the top of the stylesheet — it's the thing future edits break.
5. **Choose a density.** Tables at 52px rows and nav at 38px items suit most tools; go tighter (44/32) for high-volume data work, looser (60/44) for consumer-facing or infrequent tasks.
6. **Seed with realistic data.** Real company names, plausible dates, real brand logos where applicable. Lorem and `Item 1` make competent layouts look unfinished.

## Shell archetypes

| Shell                       | Structure                                       | Use when                                                                |
| --------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| **Sidebar + main**          | 260px nav, content                              | The default. One product area, ≤12 nav items.                           |
| **Rail + sidebar + main**   | 60px icon rail, contextual nav, content         | Five or more top-level product areas, each with its own sub-navigation. |
| **Sidebar + main + drawer** | nav, list, 340px detail                         | Users triage a list and inspect items without losing position.          |
| **Canvas + palette**        | tool palette, dotted canvas, optional inspector | The user builds or arranges something spatially.                        |

Details, plus navigation IA rules and the top-bar/filter-bar composition, in `references/shell-layouts.md`.

## Type and spacing

One geometric sans (Inter, Geist, or `system-ui`). Four sizes carry nearly everything:

```
page title    26px / 700 / -0.02em
panel title   15px / 600
body + table  14px / 400-500
label + meta  13px / 500
micro label   11px / 600 / uppercase / 0.07em tracking
```

Spacing on a 4px base. Panel padding 18px, field gap 16px, inline gap 8–10px. Body copy at `--ink-2`, never full-strength ink — full black on every line is the most common reason a dense screen feels harsh.

## The component kit

`assets/ui-kit.css` implements every primitive above, themeable through custom properties, with a complete dark theme via `[data-theme="dark"]`. `assets/kit-demo.html` renders all of it composed into a working screen — read it to see the composition patterns rather than guessing at class combinations.

Retheming means editing the `:root` block. Porting to React or Vue means keeping the class names and wrapping each block in a component; the token layer and the colour contract are the parts worth preserving.

Verified: all 52 tokens defined and used, dark theme overrides every semantic token, no orphan classes.

## Audit checklist

- [ ] Every colour on screen is explainable by the contract. No decorative hues.
- [ ] Icon tiles are one radius ratio and one icon family throughout.
- [ ] Pills for metadata, rectangles for actions — no crossover.
- [ ] Panels use hairline dividers, not gaps, wherever cells are related.
- [ ] Every metric has all three of value, delta, label.
- [ ] No blank cells. Every absence is named.
- [ ] Empty, loading, and error states exist for every data view.
- [ ] Selected, hover, focus, and disabled states exist for every interactive element.
- [ ] Numbers are tabular; columns don't shift between values.
- [ ] Seed data is realistic — no lorem, no "Item 1", no `example.com` everywhere.
- [ ] Keyboard: visible focus ring, tab order follows visual order, accordions and menus reachable.
- [ ] Contrast: body text ≥4.5:1, large text and UI ≥3:1. Check tinted pills specifically — pale tint plus mid-tone text is the usual failure.
- [ ] Dark theme, if shipped, is a token override rather than a second stylesheet.
- [ ] Narrow widths: rail and drawer collapse, tables scroll horizontally rather than reflowing into unreadable stacks.

## Reference files

- `references/components.md` — the component library: anatomy, options, and the judgement calls for tables, forms, nav, metrics, canvas nodes, charts, and overlays.
- `references/shell-layouts.md` — the four shells, navigation information architecture, top-bar and filter-bar composition.
- `references/semantic-color.md` — the colour contract, tinting method, categorical assignment, dark-mode derivation, contrast traps.
- `references/data-and-states.md` — realistic seeding, and the full state matrix every view needs.
- `assets/ui-kit.css`, `assets/kit-demo.html` — the implementation and a worked composition.
