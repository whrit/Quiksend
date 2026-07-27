# The colour contract

The most transferable idea in the reference material. In a marketing page colour is expression; in product UI colour is **data**. Every hue on screen should be traceable to a rule, and the rules should be written down before the first component is built — because that's the thing every later edit silently breaks.

**Contents:** [the four roles](#the-four-roles) · [writing the contract](#writing-the-contract) · [tinting](#tinting) · [categorical assignment](#categorical-assignment) · [dark mode](#dark-mode) · [contrast traps](#contrast-traps)

---

## The four roles

Every colour in the system belongs to exactly one role.

**1. Neutral ramp.** Ten steps from `--n0` to `--n900`, carrying every surface, border, and text level. This is 90% of the pixels. Getting the ramp right — and using `--ink-2` rather than `--ink` for body text — matters more than the accent choice.

**2. Primary.** One hue with four steps plus two tints. Its meaning is _interactive or currently active_: buttons, links, active nav, selected rows, focus rings, the highlighted bar in a chart. Indigo appears in five of seven references, and it works because it reads as software without carrying an emotional charge.

**3. Semantic triad.** Positive, caution, negative. Fixed meanings, never reassigned:

| Token    | Sampled               | Means                                                  |
| -------- | --------------------- | ------------------------------------------------------ |
| `--pos`  | `#30CC83` / `#21A989` | Healthy, complete, strong, growing, done               |
| `--warn` | `#ECA100` / `#F2B441` | Pending, partial, snoozed, in-between, needs attention |
| `--neg`  | `#FF3B57` / `#FF174F` | Failed, weak, declining, destructive, overdue          |

**4. Categorical set.** Up to six hues whose only job is to distinguish _type_ — node kinds, record categories, chart series, option cards. They carry no valence. Sampled: `#506AEB` `#FE7A5D` `#FF71E3` `#21A989` `#F2B441` `#A96CE2`.

Note the deliberate overlap: `--c4` is a green and `--c5` an amber, close to the semantic pair. That's tolerable _only_ because categorical hues appear on type indicators (tiles, node headers, tags) and semantic hues appear on state indicators (pills, status icons, deltas). If a view mixes both in the same visual slot, shift the categorical hues away from the semantic ones for that view.

## Writing the contract

Before building, write this comment at the top of the stylesheet and keep it current:

```css
/* COLOUR CONTRACT — property search tool
 * pos   Yield above target · listing active · verified broker
 * warn  Under review · price stale >30d · partial data
 * neg   Below target yield · listing withdrawn · overdue task
 * c1 Residential  c2 Commercial  c3 Land  c4 Industrial  c5 Mixed-use
 * primary: interactive + selected marker only. Never for property type.
 */
```

Two rules this enforces. **Colour is never the only channel** — pair every hue with an icon, a label, or a position, so the interface survives colourblindness, greyscale printing, and glare. And **a hue means one thing app-wide**; green meaning "strong connection" in a table and "selected" in a filter is the fastest way to make a coherent system feel arbitrary.

## Tinting

Each semantic and categorical hue needs a pale background tint for pills, washes, and node headers. Two reliable derivations:

```css
/* Fixed tints — predictable, and what the references appear to use. */
--pos-tint: #e1faea;
--warn-tint: #fdf3dc;
--neg-tint: #ffe7ea;

/* Or derive, which keeps a retheme to a single edit per hue. */
background: color-mix(in srgb, var(--pos) 14%, var(--surface));
color: color-mix(in srgb, var(--pos) 70%, var(--ink));
```

The percentages that work: **12–16% for a background wash**, **65–75% mixed toward ink for text on that wash**. Text at the pure hue on its own tint is the single most common contrast failure in this idiom — `#30CC83` on `#E1FAEA` is about 1.9:1.

Node headers in the reference builders sit at roughly 14% of the type hue over the surface, with the title and icon at the full hue — which passes because the title is 13px semibold and the hue is fully saturated against a near-white or near-black ground.

## Categorical assignment

**Assign by stable identity, never by index.** Hashing a name to a hue means the colour changes when a record is renamed; assigning by array position means it changes when something is inserted. Store the mapping — in a config object, a database column, or a constant — and let users override it for things they created.

**Order the set for maximum separation.** Adjacent categories in a list or stacked chart should be far apart in hue: indigo, coral, magenta, teal, amber, violet reads well; four consecutive blues does not.

**Six is the ceiling.** Beyond that, group into an `Other` bucket in the neutral ramp, or switch encoding channel — position, icon shape, or a small label — because nobody holds seven arbitrary colour mappings.

## Dark mode

Dark mode is a token override, not a second stylesheet. Everything in `[data-theme="dark"]` and nothing else changes.

Four adjustments the naive inversion gets wrong:

1. **Surfaces get lighter as they get closer, but stay dark.** `#0E0E12` page → `#16161B` panel → `#1A1A1E` inset. Never invert to white cards on black; the glare is worse than light mode.
2. **Saturated hues need lifting.** `#30CC83` on near-black is muddy; the dark references use `#75FFD4`. Raise lightness and often saturation — the vivid magenta and mint in the dark reference apps are deliberate, not accidental.
3. **Tints invert direction.** A light tint becomes a _dark_ wash of the same hue: `--pos-tint` goes from `#E1FAEA` to `#12302A`. Same 12–16% mix, opposite base.
4. **Borders need more contrast than you expect.** `#2A2A31` against `#16161B` is subtle but sufficient; anything closer disappears and the hairline structure — which is doing the layout work — collapses.

Shadows barely function on dark grounds. Lean on borders and surface-lightness steps for elevation instead, and if you keep shadows, make them much stronger (`rgba(0,0,0,.5)`).

## Contrast traps

Check these specifically; they're where this idiom fails audits:

- **Pill text on pill tint.** The most common failure. Use the 65–75% ink mix.
- **`--ink-3` on `--surface-2`.** Placeholders and empty-state text on inset backgrounds often land near 3:1. Acceptable for decorative hints, not for meaningful content like `No contact` — bump those to `--ink-2` if they carry information.
- **Amber anything.** `#ECA100` fails on white for text at any size below large. Use it as a fill with dark text, or darken to about `#8A5D00` for text.
- **Accent-on-accent.** White text on `#474FF5` passes; white on a lighter step like `#9EA3FF` does not.
- **Focus rings on tinted rows.** A primary focus ring on a primary-tinted selected row is invisible. Use an offset outline so the ring sits on the neutral ground.
- **Disabled at 45% opacity** can drop below 3:1. That's acceptable for genuinely inert controls, but never disable something the user needs to _read_.

Body text ≥4.5:1, large text and UI components ≥3:1. Test in both themes; passing light does not imply passing dark.
