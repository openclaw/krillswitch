# Design

Visual system for the krillswitch admin dashboard (`apps/admin`).
Mood: network-operations desk — calm cobalt indicators on layered neutral
surfaces, legible at a glance, in light or dark.

## Theming

Light and dark themes share one set of semantic tokens. `:root` holds the
light theme; `[data-theme="dark"]` overrides the same tokens. The resolved
theme (`light` / `dark`) is written to `<html data-theme>` by a tiny inline
script in `index.html` before first paint (no flash), then kept in sync by
`useThemeMode`. Default mode is `system` (follows the OS); the topbar toggle
lets an operator pin `light` or `dark`, persisted to `localStorage`
(`krillswitch-theme`). `color-scheme` is set per theme so native controls and
scrollbars match.

Every color reads from a token — no hard-coded `white` or raw colors in
components — so both themes stay correct.

## CSS architecture

Three layers on one token system:

- **Carapace** (`@openclaw/carapace`) — the shared OpenClaw design system, and
  the source of truth for the `--oc-*` contract: tokens, light/dark themes,
  typography, the stable component layer, and the candidate control, feedback,
  data, and application layers. `app.css` imports it first, unlayered, so
  everything below is an override rather than a transcription. Its `base.css`
  is deliberately skipped because `app.css` owns the global resets.

  Consume it, never copy it. If a value or a component box already exists
  upstream, use the `oc-*` class and delete the local rule. Anything that stays
  local should be a deliberate product delta with a comment saying why — brand
  accent, rounded console chrome, the viewport-filling frame, fixed table
  layout for long flag keys.
- `app.css` — KrillSwitch's own layer: the brand overrides listed above, the
  short aliases (`--bg`, `--ink`, `--accent`, …) that the Tailwind bridge and
  existing components read, plus the layout and components Carapace has no peer
  for (topbar, identity cluster, theme toggle, persona cards, auth screens).
- Tailwind v4 (`index.css`, via `@tailwindcss/vite`) — utilities for new
  component work and the `shadcn/ui` primitives. Preflight is **not** imported
  (`app.css` owns resets; preflight's `* { margin: 0 }` would clobber existing
  spacing). The Tailwind/shadcn semantic colors (`background`, `popover`,
  `primary`, `border`, `accent`, …) are bridged to the `app.css` tokens with
  `@theme inline`, so a utility like `bg-popover` resolves to `var(--surface)`
  and re-themes with `[data-theme]` automatically — no separate dark block.
  The dark variant follows `[data-theme="dark"]`, not a `.dark` class.

`shadcn/ui` components live under `src/components/ui`, use the `@/` alias and
the `cn()` helper (`clsx` + `tailwind-merge`), and are styled with the bridged
tokens so they look native in both themes. `components.json` lets the CLI add
more later. Where Carapace has the matching control, compose onto it rather
than restyling: the select trigger carries `oc-select` and keeps only the
Radix-specific delta.

Upgrading Carapace is a version bump in `apps/admin/package.json` (it installs
from a Git tag, not npm). Because the console consumes the package rather than
copying it, upstream fixes arrive with the bump.

## Color

OKLCH, restrained strategy: layered neutral surfaces, one cobalt accent for
primary actions/selection/focus, semantic state colors only where state
exists. The KrillSwitch ember accent is pinned over Carapace's coral so the
product keeps its identity; green still means "flag ON" and the danger tone
still means destructive.

Surface layering (three depths): `--bg` is the canvas, `--surface` is a raised
panel/table/input that lifts off it with `--shadow-panel`, `--surface-muted`
is recessed chrome (topbar, rail, table header).

Text: `--ink` (primary), `--ink-muted` (secondary, ≥4.5:1), `--ink-faint`
(small uppercase labels + placeholders, kept dark/bright enough to clear AA on
every surface — not a light gray).

Accent: `--accent` (fill for primary buttons/active states), `--accent-text`
(accent-colored text on bg, ≥4.5:1), `--accent-soft` (selected-row / active-nav
tint), `--accent-ring` (focus glow).

State: each has a legible `-fg` plus a tinted `-bg`. `--ok` (green) for flag
ON, `--warn` (amber), `--danger` (red). `--danger-solid` backs destructive
buttons with white text in both themes. Flag OFF uses neutral ink, never red.

Controls: `--control-track` / `--control-knob` (toggle), `--row-hover`.

## Typography

`Manrope` (self-hosted via `@fontsource`) for all UI; `IBM Plex Mono` for flag
keys, eval keys, token values, variation values, and JSON. Matches the
OpenClaw / ClawHub family.

Fixed px scale: 12px uppercase labels (table headers, rail groups, field
labels), 13.5px mono/meta, 14px section hints, 15px body + table cells +
controls + nav, 18px section titles, 28px page titles. The steps are spaced so
heading, section, and body read as distinct tiers (not one small cluster).
Weights: 400 body, 500 labels/nav, 600 section titles, 700 page titles.
Negative tracking on headings. No fluid type.

## Layout

App shell: a left rail that carries the brand (a generous logo header whose
bottom border lines up with the topbar's) over the nav, beside a content
column whose own top bar holds just the theme toggle + identity. The rail
collapses to a top strip under ~768px (logo inline, nav scrolls horizontally).
A fixed
backdrop sits behind everything: a faint cobalt glow (top-right) over a subtle
dot grid, masked to fade at the edges. Tables run full-width inside a framed,
shadowed panel: 42px rows, hairline row separators (no vertical cell dividers),
sticky uppercase header. Create/edit screens are a single focused column (no
side panels): fields stacked label-over-input with inline hints, and the
primary action at the bottom of the form, never floated to one side. The flag
editor follows the same single-column flow: a plain-language state line, then
variations, then a collapsible Targeting section, then Save at the bottom.

## Components

- Buttons: 32px height, 6px radius, subtle shadow. Accent fill for the single
  primary action per view; quiet (surface + border) for everything else;
  danger fill only for destructive confirms. Active nudges 0.5px down.
- Theme toggle: 3-segment control (system / light / dark) with icons, in the
  topbar, `aria-pressed` per option.
- Flag state: the flags table shows On/Off read-only with a chevron link to the
  flag page; on/off (and everything else) is changed there, never inline in the
  table. The flag page uses an explicit ON/OFF switch with the state word beside
  it, tokenized track/knob, never a bare unlabeled switch.
- Badges: role and environment chips, pill radius, `--surface-muted` fill;
  role chips tint with their semantic color.
- Inputs: 32px, `--line-strong` border, accent border + 3px ring on focus;
  placeholder uses `--ink-faint` (AA).
- Select: `shadcn/ui` Select on Radix primitives — never a native `<select>`,
  whose popup the browser renders unstyled. Trigger matches an input; the
  popup is portal-rendered, themed from our tokens, with a check on the active
  option and keyboard nav.
- Combobox: typeable filter input with a themed option list (change-log
  project/flag filters). Free text plus suggestions from real data; ARIA
  combobox pattern. Custom (not Radix) because it allows arbitrary text.
- Empty states (`EmptyState`): one component for every "nothing here" panel —
  accent icon disc, title, one-line description of what goes here and why, and
  an optional primary CTA. First-use states teach and lead to the next action
  ("Create your first project/flag"); "no results" states drop the icon and
  offer "Clear filters"; read-only roles get the explanation without a CTA.
- Mutating actions live on dedicated pages, not inline forms or row controls:
  new project, new environment, new flag, edit flag, mint token, and change
  role each have their own route. List rows and empty-state CTAs link out to
  them; a minted token's once-only secret is revealed on its page.
- Confirm modal (`ConfirmDialog`, Radix AlertDialog): destructive, hard-to-undo
  actions (delete flag, delete environment, revoke token, rotate eval key)
  confirm in a focus-trapped modal with a danger-filled confirm button. The one
  sanctioned modal; everything else is a page.
- Table rows that map to a destination are fully clickable via the stretched-
  link pattern (the row's primary link covers the row; it stays a real,
  focusable anchor). Projects → project, flags → flag page, members → role page.
- Boot/error states: centered framed panel with wordmark and a single action
  (retry, sign in), spinner for the pending boot state.

## Onboarding

No tour, no separate tutorial mode — empty states carry the activation path,
each leading to the next real action via a dedicated page (every create/edit is
its own page). A new admin lands on an empty Projects panel ("Create your first
project") → the new-project page, whose inline field hint explains what a key
is → a fresh project with no environments prompts "Add an environment" → once an
environment exists, "Create your first flag". The change log explains itself
before any entry exists. So first value (a flag they can toggle and target
without a deploy) is a few clicks from a cold start, and experienced users are
never blocked or gated.

## Motion

150ms ease-out on hover/focus/menu/control transitions; state changes (toggle
flips, row updates) snap or crossfade. No entrance choreography. All
transitions and the boot spinner collapse to instant under
`prefers-reduced-motion`.
