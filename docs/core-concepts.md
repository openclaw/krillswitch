---
title: Core concepts
description: Understand the KrillSwitch hierarchy, identities, and evaluation lifecycle.
---

# Core concepts

## Projects

A project groups flags for one product or service. Project keys are stable machine identifiers such as `clawhub`. Admins create and delete projects.

## Environments

Each project has independent environments such as `development`, `staging`, and `production`. An environment owns:

- its flag configuration;
- a public evaluation key beginning with `ks_`;
- key rotation history;
- an isolate-local configuration-cache entry.

Evaluation keys identify a flag set. They are safe to embed in browser applications and are not management credentials.

## Flags and variations

A flag has a stable key, one of four value kinds, an enabled state, ordered variations, an off variation, a default variation, and optional targeting. See [Flag model](flag-model.md).

## Context

Every evaluation needs a stable context key. The key can represent a user, workspace, installation, request cohort, or another domain identity.

```json
{
  "context": {
    "key": "user-123",
    "attributes": {
      "role": "admin",
      "plan": "pro",
      "beta": true
    }
  }
}
```

Attributes may be strings, numbers, or booleans. They are used only by exact-match targeting rules.

## Evaluation order

KrillSwitch evaluates each flag in a fixed order:

1. Disabled flag → off variation.
2. Exact context-key target → targeted variation.
3. First matching attribute rule → rule variation.
4. Deterministic percentage split → rollout variation.
5. Default variation.

The response includes the winning variation id and reason. See [Targeting and rollouts](targeting.md).

## Operators and tokens

Human sessions authenticate through Better Auth and GitHub. Role grants decide whether a session is admin, editor, viewer, or ungranted. CLI and agent automation use `ksat_` access tokens with editor or viewer scope. Access tokens can never become admins.

## Change log

Management mutations write an append-only audit entry in the same D1 batch as the state change. If either write fails, neither lands. Entries include the actor, action, target, before/after values, and time.
