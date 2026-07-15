---
title: Flag model
description: Configure typed variations, off values, defaults, and enabled state.
---

# Flag model

## Value kinds

| Kind | Example | Typical use |
| --- | --- | --- |
| `boolean` | `true` | Feature availability |
| `string` | `"compact"` | Modes, copy, provider choice |
| `number` | `25` | Limits, thresholds, tuning |
| `json` | `{ "density": "high" }` | Structured configuration |

Every variation on a flag must match the flag kind. The dashboard and API validate this at the write boundary.

## Variations

Variations are ordered, stable values with generated identifiers. Targeting rules refer to identifiers internally; the CLI targeting command accepts variation indexes from `flags get` for operator convenience.

Each flag chooses:

- **off variation** — served whenever the flag is disabled;
- **default variation** — served when the flag is enabled and no target, rule, or rollout matches.

These may point to the same variation, but often differ for boolean flags.

## Enabled state

Disabling a flag short-circuits all targeting and serves the off variation. Targeting remains configured and resumes when the flag is enabled again.

```sh
krillswitch flags toggle souls -p clawhub -e production --off
krillswitch flags toggle souls -p clawhub -e production --on
```

## Creation

```sh
krillswitch flags create new_nav \
  --project clawhub \
  --kind boolean \
  --variation false \
  --variation true \
  --enabled
```

Use the dashboard for full variation naming and default/off selection. Use `flags get --json` before changing targeting so automation works from current identifiers and values.

## Deletion

Deletion is an explicit dashboard operation. The change log retains the historical event; application code must still carry a safe default for any deleted flag.
