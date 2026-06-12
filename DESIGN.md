# Design

Visual system for the krillswitch admin dashboard (`apps/admin`).
Mood: network-operations desk — calm cobalt indicators on neutral surfaces,
everything legible at a glance.

## Color

OKLCH, restrained strategy: neutral surfaces, one cobalt accent for primary
actions/selection/focus, semantic state colors only where state exists.

- `--bg`: oklch(0.985 0.002 230) — content background, near-white with a
  whisper of the brand hue
- `--surface`: oklch(0.962 0.004 230) — sidebar / toolbar / table-header layer
- `--ink`: oklch(0.24 0.015 240) — primary text
- `--ink-muted`: oklch(0.45 0.02 240) — secondary text (still ≥4.5:1 on bg)
- `--accent`: oklch(0.52 0.13 235) — cobalt; primary buttons, active nav,
  focus rings, selected rows
- `--accent-ink`: white text on accent
- `--line`: oklch(0.88 0.006 230) — hairline borders
- States: `--ok` oklch(0.56 0.12 150), `--warn` oklch(0.62 0.13 70),
  `--danger` oklch(0.55 0.18 25). Flag ON uses `--ok`; OFF uses neutral ink,
  not red (off is a valid state, not an error).

## Typography

Single family: system-ui stack (`-apple-system, "Segoe UI", Inter, sans-serif`)
for everything; `ui-monospace, "SF Mono", monospace` for flag keys, eval keys,
variation values, and JSON.

Fixed rem scale, ratio ~1.2: 12px meta/labels, 13px table data, 14px body,
16px section titles, 20px page titles. Weights: 400 body, 500 labels/nav,
600 titles. No fluid type.

## Layout

App shell: slim top bar (project/environment context + identity) over a
left rail nav (collapses under ~768px) and a dense content pane. Tables run
full-width, 32px rows, hairline row separators, sticky header. Forms are
two-column label/control grids that stack at narrow widths.

## Components

- Buttons: 28px height, 4px radius, accent fill for the single primary
  action per view; quiet (border + ink) for everything else; danger fill
  only for destructive confirms.
- Toggle: explicit ON/OFF switch with the state word next to it; never a
  bare unlabeled switch.
- Badges: role and environment names in small caps-free 12px chips with
  `--surface` fill and 1px `--line` border; state badges use semantic colors.
- Inputs/selects: 28px, 1px `--line` border, accent focus ring (2px outline,
  offset 1px).
- Empty states: one sentence + the relevant action button, no illustration.

## Motion

150–200ms ease-out on hover/focus/menu transitions; state changes (toggle
flips, row updates) snap or crossfade. No entrance choreography. All
transitions collapse to instant under `prefers-reduced-motion`.
