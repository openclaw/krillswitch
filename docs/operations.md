---
title: Operations
description: Monitor propagation, cache behavior, migrations, audit history, and production health.
---

# Operations

## Production topology

Two Workers share one D1 database:

- `krillswitch-public` on `flags.openclaw.ai` for evaluation;
- `krillswitch` on `switch.openclaw.ai` for the dashboard and management API.

Deploy public and admin components separately. Their host boundary is enforced inside the Worker.

## Migrations

Apply D1 migrations before deploying either Worker:

```sh
pnpm --dir apps/api db:migrate:remote
```

The GitHub deploy workflow performs this step. Keep schema changes backward-compatible across the brief two-Worker rollout window.

## Configuration propagation

Each Worker isolate caches an environment configuration for one second. A write clears the current isolate's cache; other isolates refresh within the TTL. SDK poll cadence is separate from server propagation.

## Health probes

An unauthenticated public evaluation should return `401`, not an Access redirect:

```sh
curl -i -X POST https://flags.openclaw.ai/v1/eval \
  -H 'Content-Type: application/json' \
  -d '{"context":{"key":"smoke"}}'
```

An unauthenticated request to `https://switch.openclaw.ai/admin/me` should return `401`. The dashboard itself remains public until GitHub sign-in.

With a real eval key, verify `Cache-Control: private, no-store`, `ETag`, and `Server-Timing`.

## Benchmarks

```sh
pnpm bench
TARGET_URL=https://flags.openclaw.ai TARGET_LABEL=production pnpm bench
```

The benchmark records sustained load, timing splits, and cache-miss cadence. Keep deployed-target load modest.

## Audit review

Use the dashboard or CLI after a production change:

```sh
krillswitch log tail --project clawhub --limit 20 --json
```

Confirm actor, action, target, and before/after state. Treat unexplained token, role, key, or project events as security signals.
