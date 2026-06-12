# krillswitch

OpenClaw's self-hosted feature flag service: a Cloudflare Worker (Hono + D1 +
Drizzle) with a pure TypeScript evaluator and typed SDKs. Replaces
LaunchDarkly for ClawHub.

## Local development

No Cloudflare account needed — everything runs in wrangler local mode.

```sh
bun install
bun dev
```

`bun dev` builds the admin dashboard, applies D1 migrations, seeds a
`clawhub` project with a boolean `souls` flag, and starts the worker on
http://localhost:8799 (the dashboard is served at that root; sign in with a
dev persona — admin, editor, viewer, or nogrant).

Evaluate the seeded flag:

```sh
curl -s -X POST http://localhost:8799/v1/eval \
  -H 'Authorization: Bearer ks_clawhub_development_local' \
  -H 'Content-Type: application/json' \
  -d '{"context":{"key":"some-user"}}'
```

```json
{"flags":{"souls":{"value":true,"variationId":"var_souls_on","reason":{"kind":"default"}}}}
```

Toggle the flag in local D1 and the next response flips:

```sh
cd apps/api
bunx wrangler d1 execute krillswitch --local \
  --command "UPDATE flag_environments SET enabled = 0 WHERE id = 'fe_souls_dev'"
```

## Workspace

- `apps/api` — the Worker: `POST /v1/eval`, session-guarded `/admin/*` API,
  better-auth under `/api/auth/*`, D1 schema, seed fixture.
- `apps/admin` — the admin dashboard SPA (React + Vite), served from Worker
  assets.
- `packages/core` — `@openclaw/krillswitch-core`: flag/context types and the
  pure `evaluateFlag` function (no I/O).

## Benchmarks

```sh
bun bench                                          # against the local stack
TARGET_URL=https://… TARGET_LABEL=workers-dev bun bench
```

Three scenarios run against `POST /v1/eval` and a dated JSON report lands in
`bench/results/` (UTC date + target label):

- **sustained** — autocannon load (default 25 connections, 15s) for
  round-trip p50/p95/p99, RPS, and error count. Exits nonzero above a 1%
  error rate so it can gate CI.
- **server-timing split** — a sampler alongside the load records each
  response's `Server-Timing` (cache hit/miss, eval/config/total processing).
  Workers isolate timers only advance on I/O, so 0ms hit-path processing
  means evaluation did no I/O.
- **miss cadence** — 10s of unloaded sampling; misses ≈ elapsed seconds
  proves at most one D1 read per second per environment.

Tool version is pinned (`autocannon` in root devDependencies) so results
stay comparable. Keep load modest against deployed targets.

## Commands

```sh
bun run test       # core unit tests + worker integration tests (vitest)
bun run typecheck  # tsc across workspaces (generates worker types first)
bun run lint       # biome check
bun run lint:fix   # biome check --write
```
