---
title: Development
description: Workspace layout, commands, tests, generated files, and contribution checks.
---

# Development

## Workspace

| Path | Purpose |
| --- | --- |
| `apps/api` | Hono Worker, D1 schema, auth, management API, integration tests |
| `apps/admin` | React + Vite operator console |
| `apps/demo` | SDK demonstration app |
| `packages/core` | Pure evaluator and shared contracts |
| `packages/react` | Typed React provider and hooks |
| `packages/cli` | Human/agent management CLI |

## Commands

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm lint:fix
pnpm docs:build
pnpm verify:sdk-packages
pnpm --dir apps/admin build
pnpm --dir apps/demo build
pnpm --dir packages/cli build
```

API tests use Wrangler's local Workers pool and apply the real D1 migrations. Core and React tests run in Vitest. The SDK package check builds and packs both public packages, validates their tarball metadata and contents, and loads every public entry point from the packed artifacts.

## Database changes

Edit the Drizzle schema, generate a migration, inspect it, then prove local setup and integration tests. Never hand-wave migration order; both production Workers share the database.

## Auth schema generation

```sh
pnpm --dir apps/api db:generate-auth
```

The script uses the runtime-matched Better Auth CLI and formats the generated file. A clean regeneration must not leave a diff unless the auth model changed.

## Documentation

Every public docs page is Markdown under `docs/`. `pnpm docs:build` renders the site, validates internal links, copies local brand/fonts, and emits `llms.txt`, a sitemap, and a GitHub Pages artifact.

## Change discipline

User-visible changes belong in `CHANGELOG.md`. Add regression tests for bugs when the contract is testable. Keep compatibility only for named public API, CLI, config, data, or upgrade contracts.
