# Data and states

Two things separate a screen that looks designed from one that looks scaffolded: the plausibility of the data in it, and whether its non-happy states exist. Both are usually left to last, and both are visible immediately.

**Contents:** [realistic seeding](#realistic-seeding) · [the state matrix](#the-state-matrix) · [empty states](#empty-states) · [loading](#loading) · [errors](#errors) · [density](#density)

---

## Realistic seeding

Layout quality is invisible under bad data. A perfectly built table full of `Item 1 / Lorem ipsum / example.com` looks unfinished; the same table with real company names, real logos, and plausible dates looks shipped.

**Names.** Use real, recognizable entities where the domain allows — the reference apps list Zendesk, Figma, Stripe, Notion, Webflow, Atlassian. For people, use varied full names across plausible ethnicities and lengths; a column of `John Smith / Jane Doe` reads as placeholder. Include at least one uncomfortably long value to prove truncation works.

**Brand logos.** Where the data is about known products or companies, use their actual marks at 18px with a 4px radius. Two references do this and it's most of why their tables feel real. Never approximate a logo with a coloured initial when the real mark is available.

**Numbers.** Vary the magnitude and precision: `212,212` beside `123` beside `11,231`. Include a decimal (`54.72%`), a currency (`$2,980,000`), and a duration (`2h 41m`) if the domain has them. Uniform round numbers look generated.

**Dates.** Spread across a plausible range, formatted consistently (`12 Jan 2026`). Include at least one absent value so the empty treatment is exercised.

**Distributions.** Deliberately include the edge cases: one row with every field populated, one with several missing, one at maximum length, one selected, one in each status. A table where every row is complete and healthy hides every state you need to have designed.

**Deltas.** Mix positive and negative. A dashboard where every metric is up reads as a mockup — and worse, the negative pill styling goes untested.

## The state matrix

Every data view needs all of these designed. Work the grid rather than trusting memory:

| State                   | Applies to                | Treatment                                                                               |
| ----------------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| **Loading (first)**     | any async view            | Skeletons matching the real layout's shape                                              |
| **Loading (refresh)**   | already-populated view    | Keep the data, show a subtle inline indicator. Never blank out content you already have |
| **Empty (no data yet)** | new account               | Explain what will appear here, plus the action that creates the first one               |
| **Empty (no results)**  | filtered view             | Name the filters responsible, offer to clear them                                       |
| **Partial**             | some fields missing       | Named absences per cell, not blanks                                                     |
| **Error (recoverable)** | failed fetch              | State what failed and offer retry                                                       |
| **Error (row-level)**   | one bad record            | Mark that row, keep the rest usable                                                     |
| **Selected**            | rows, cards, nodes        | Checkbox + tint, or border + ring                                                       |
| **Hover**               | rows, cards, nav          | Surface-2 background                                                                    |
| **Focus**               | every interactive element | Visible ring, offset so it survives tinted backgrounds                                  |
| **Disabled**            | unavailable actions       | 45% opacity plus a reason on hover                                                      |
| **Read-only**           | permission-limited        | Distinct from disabled: show the value, hide the control                                |

Interactive elements also need each combination that can co-occur — selected _and_ hovered, focused _and_ disabled. Selected-plus-hovered is the one that usually looks wrong.

## Empty states

Three parts, in this order: an `lg` tinted icon tile, a heading naming the situation, and one line saying what to do. Then, when applicable, one button.

Write the _specific_ situation, not a generic absence:

> **No companies match** — Try removing the Coastal East filter, or widen the budget range. `[Reset filters]`

> **No workflows yet** — Workflows run automations when something happens in your account. `[Create workflow]`

The first names the filters actually applied and offers the exact remedy. The second explains the concept, because a user seeing it has never used the feature. Same component, different jobs — and "No data found" serves neither.

Keep empty states inside the panel that would hold the data, at the same width. An empty state centred in the whole viewport loses the context that explains it.

## Loading

**Skeletons over spinners** for content whose shape you know. Match the real layout: three lines at 55%, 85%, 70% width look like text; three identical bars look like a loading bar. Shimmer with a 1.4s background-position animation, and disable it under `prefers-reduced-motion`.

**Spinners only** for indeterminate actions with no shape to preview — a submit button mid-request, a file upload.

**Never blank existing content on refresh.** A table that empties and refills on every filter change feels broken even when it's fast. Keep the rows, dim slightly, show a thin progress indicator.

**Stagger nothing.** Sequenced skeleton reveals are a marketing-page technique; in a tool they read as slowness.

## Errors

Three levels, three treatments:

**View-level** — replace the panel content with an error state: what failed, why if known, and a retry button. Keep the surrounding chrome so the user can navigate away.

**Row-level** — mark the row with a `--neg` left border or status icon and keep every other row usable. One bad record must not break a table.

**Action-level** — a toast. Name the object, the field, and the fix: `Import failed on row 42 / Column "Domain" was empty. Fix the row and re-upload.` Compare `Something went wrong`, which tells the user nothing and costs a support ticket.

Never a modal for a non-blocking error, never a red banner that persists after the problem is resolved, and never technical detail as the primary message — put the stack trace behind a `Details` disclosure if it's useful at all.

## Density

Density is a product decision, not a style preference. Pick one and hold it across the whole app.

|               | Compact | Default | Comfortable |
| ------------- | ------- | ------- | ----------- |
| Table row     | 44px    | 52px    | 60px        |
| Nav item      | 32px    | 38px    | 44px        |
| Input         | 34px    | 40px    | 46px        |
| Panel padding | 14px    | 18px    | 24px        |
| Body size     | 13px    | 14px    | 15px        |

**Compact** for high-volume data work where users scan hundreds of rows and know the app well. **Default** for most tools. **Comfortable** for infrequent or consumer-facing tasks, and anything used on touch devices — 44px is the minimum comfortable touch target regardless of the chosen density.

Offer a density toggle only if you'll genuinely maintain all rows of the table above; a half-implemented toggle is worse than a single well-chosen density.
