---
title: Targeting and rollouts
description: Target identities, match attributes, and assign stable percentage cohorts.
---

# Targeting and rollouts

## Precedence

Targeting is intentionally simple: exact identities first, exact attribute rules second, deterministic splits third. Earlier dimensions win.

## Context targets

Use a target to pin one or more context keys to a variation. This is the highest-priority enabled-state match.

Good uses include a QA account, a known workspace, or an early-access customer.

## Attribute rules

A rule matches one context attribute against a list of exact values. Rules are evaluated in order; the first match wins.

```json
{
  "variationIndex": 0,
  "attribute": "role",
  "values": ["admin", "owner"]
}
```

KrillSwitch does not coerce types. The number `1`, string `"1"`, and boolean `true` are distinct values.

## Percentage splits

A split distributes contexts across variations with integer weights totaling 100. Bucketing hashes the flag key with the context key, so the same identity remains in the same cohort across requests and Worker isolates.

Changing weights can move identities. Treat rollout edits as production changes, inspect the resulting change-log entry, and use stable context keys.

## CLI replacement model

`flags targeting set` replaces the entire targeting specification. Omitted dimensions are cleared.

```sh
krillswitch flags get souls -p clawhub -e production --json

krillswitch flags targeting set souls -p clawhub -e production --targeting '{
  "allowlist": [{ "variationIndex": 0, "contextKeys": ["user-123"] }],
  "rules": [{ "variationIndex": 0, "attribute": "plan", "values": ["pro"] }],
  "split": [
    { "variationIndex": 0, "weight": 10 },
    { "variationIndex": 1, "weight": 90 }
  ]
}'
```

Read the current flag first when you intend to preserve an existing dimension.

## Evaluation reasons

The API returns one of `off`, `target`, `rule`, `rollout`, or `default`. Rule reasons include the matching attribute name. These reasons are useful in diagnostics and live verification.
