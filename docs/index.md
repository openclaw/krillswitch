---
title: Overview
description: Edge-native feature flags with deterministic evaluation, typed SDKs, and an operator-first control plane.
---

# KrillSwitch

## One small control plane

KrillSwitch is OpenClaw's self-hosted feature-flag service. It combines a Cloudflare Worker, D1, a React operator console, a pure TypeScript evaluator, and typed SDKs in one deliberately compact system.

The service keeps the public evaluation path separate from management. Applications call `POST /v1/eval` with an environment key. Operators use an Access-protected dashboard or role-scoped CLI token. Every mutation and actor lands in the same append-only change log.

## Why it exists

- **Deterministic decisions.** The same flag, context key, and attributes produce the same result.
- **Fast reads.** Hot evaluations run from an isolate-local configuration cache with no I/O.
- **Bounded propagation.** An update becomes visible across isolates within one second.
- **Typed defaults.** React renders code-owned defaults immediately and safely widens primitive types.
- **Auditable writes.** Flag edits, key rotations, project changes, role grants, and token lifecycle events carry actor attribution.
- **Small operational surface.** One Worker codebase, two host boundaries, one D1 database.

## Pick a path

- [Getting started](getting-started.md) — run the stack locally and evaluate the seeded flag.
- [Core concepts](core-concepts.md) — projects, environments, keys, flags, and contexts.
- [CLI](cli.md) — human and agent workflows with stable JSON output.
- [React SDK](react-sdk.md) — typed manifests, cached values, and polling.
- [HTTP API](api.md) — evaluation contract, caching headers, and management boundary.
- [Cloudflare deployment](deploy-cloudflare.md) — production topology and Access policy.
- [Security model](security.md) — secrets, public identifiers, roles, and trust boundaries.

## Architecture at a glance

| Surface | Host | Audience | Protection |
| --- | --- | --- | --- |
| Docs | `krillswitch.com` | Everyone | GitHub Pages |
| Evaluation | `flags.openclaw.ai` | SDKs and applications | Environment eval key |
| Dashboard + admin API | `switch.openclaw.ai` | Operators and automation | Cloudflare Access plus app authorization |

The evaluation host cannot serve dashboard assets or admin routes. The admin host cannot evaluate flags. That split is enforced inside the Worker as well as at the edge.

## Source and status

KrillSwitch is developed at [openclaw/krillswitch](https://github.com/openclaw/krillswitch). The root changelog records shipped behavior. Application releases are versioned GitHub releases; the core and React SDKs are independently versioned npm packages.
