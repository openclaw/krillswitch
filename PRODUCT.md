# Product

## Register

product

## Users

OpenClaw maintainers (Jesse plus a handful of explicitly-granted editors and
org-member viewers) operating feature flags for OpenClaw apps. They arrive
mid-task: flip a flag, adjust a rollout, check what changed. Expert users,
short visits, high cost of mistakes (a wrong toggle changes production
behavior within a second).

## Product Purpose

krillswitch is OpenClaw's self-hosted feature-flag service (LaunchDarkly
replacement). The admin dashboard is the operator surface: projects →
environments → flags → targeting detail, plus role grants, eval keys, and a
change log. Success = an editor can find and safely change a flag in under a
minute, and every change is attributable.

## Brand Personality

Calm, exact, unceremonious. A network-operations desk: dense status at a
glance, controls that look like what they do, nothing animated for show.

## Anti-references

- Marketing-site styling anywhere in the app shell (heroes, gradients,
  full-bleed illustrated empty states). Restrained first-run empty states —
  small accent icon, a line of copy, one CTA — are expected, not banned.
- LaunchDarkly's crowded chrome: this tool has one job per screen.
- Dashboard-template decoration: stat cards with icons, colored side-stripes.

## Design Principles

- Tables and forms over decoration; density is a feature for expert users.
- State is the only thing that earns color (on/off, role, environment).
- Destructive and production-affecting actions read louder than safe ones.
- Long technical strings (flag keys, JSON variation values) are first-class
  content: never clipped, always copyable.
- The UI only mirrors server-side authorization; disabled means the API
  would refuse, and viewers see-but-cannot-touch.
- Empty states teach and point at the next real action (create the first
  project, the first flag), never a blank panel; read-only roles get the
  explanation without the action.

## Accessibility & Inclusion

WCAG AA contrast (≥4.5:1 body text), full keyboard operability for all flag
mutations, `prefers-reduced-motion` honored (state changes crossfade or snap).
