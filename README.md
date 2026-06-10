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

`bun dev` applies D1 migrations, seeds a `clawhub` project with a boolean
`souls` flag, and starts the worker on http://localhost:8787.

Evaluate the seeded flag:

```sh
curl -s -X POST http://localhost:8787/v1/eval \
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

- `apps/api` — the Worker: `POST /v1/eval`, D1 schema, seed fixture.
- `packages/core` — `@openclaw/krillswitch-core`: flag/context types and the
  pure `evaluateFlag` function (no I/O).

## Commands

```sh
bun test           # core unit tests + worker integration tests
bun run typecheck  # tsc across workspaces (generates worker types first)
bun run lint       # biome check
bun run lint:fix   # biome check --write
```
