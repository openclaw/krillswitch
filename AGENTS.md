# AGENTS.md - Krillswitch

## Purpose

Krillswitch is OpenClaw's self-hosted feature flag service. It combines a
Cloudflare Worker and D1-backed control plane with framework-neutral evaluation,
typed SDKs, and an operator dashboard.

Keep public evaluation independent from dashboard authentication. Treat flag
evaluation, SDK exports, migrations, and deployment workflows as compatibility
and security boundaries.

## Repository

- GitHub: `https://github.com/openclaw/krillswitch`
- Documentation: `https://krillswitch.com`
- Default branch: `main`
- Runtime: Node.js `>=22.22.0`
- Package manager: `pnpm`; use the version declared by the repository
- Human contribution guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Security policy: [`SECURITY.md`](SECURITY.md)

Read the nearest scoped `AGENTS.md` before changing files below this directory.
`CLAUDE.md` is a compatibility symlink to this file; edit `AGENTS.md` only.

## Architecture Boundaries

- `apps/api` owns the Worker, D1 schema, public evaluation, admin API, and
  authentication.
- `apps/admin` owns the dashboard SPA. It must not become a prerequisite for
  public evaluation.
- `packages/core` stays framework-neutral and performs no I/O.
- `packages/react` owns React bindings and server evaluation helpers.
- `packages/cli` is private until a separate public package contract is
  explicitly approved.
- D1 migrations, auth changes, token handling, and deployment configuration are
  security-sensitive. Preserve existing production data and access boundaries.
- SDK export maps, evaluation order, wire types, and package versions are public
  compatibility surfaces. Core and React SDK releases move in lockstep.

## Workflow

Install dependencies and use repository scripts:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm docs:build
pnpm verify:sdk-packages
```

Run the smallest relevant command while iterating. Validate Worker behavior with
Wrangler's local mode unless live deployment proof is explicitly required.

## Change Rules

- Keep changes focused and add tests for behavior changes.
- Add an `Unreleased` changelog entry for user-visible, compatibility, security,
  deployment, or release changes.
- Do not edit generated output or dependency lockfiles by hand.
- Do not add JSON or text state stores where D1 or an existing database owns the
  state.
- Never commit credentials, private paths, private hosts, customer data, or
  unredacted logs.
- Use conventional commit and pull request titles such as
  `fix(eval): preserve boolean defaults`.

## Review And Release

- Run `.agents/skills/autoreview/scripts/autoreview` for non-trivial changes.
- Verify accepted findings against source, tests, and operator-visible behavior.
- Application releases use `vX.Y.Z` tags.
- SDK releases use `sdk-vX.Y.Z` tags from `main` and publish only
  `@openclaw/krillswitch-core` and `@openclaw/krillswitch-react` through
  `.github/workflows/npm-release.yml`.
- Never publish locally or add long-lived npm tokens to repository settings.
