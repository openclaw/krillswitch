# Contributing to Krillswitch

Thanks for helping improve OpenClaw's feature flag service.

Report security issues privately as described in [SECURITY.md](SECURITY.md).
Search existing issues and pull requests before opening a duplicate.

## Before You Start

- Bugs and small fixes can go directly to a focused pull request.
- Discuss D1 schema changes, authentication changes, breaking SDK changes, and
  large architecture changes in an issue before implementation.
- Keep public evaluation independent from dashboard authentication.

## Development Setup

Use the Node.js and pnpm versions declared by the repository.

```bash
corepack enable
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm docs:build
pnpm verify:sdk-packages
```

No Cloudflare account is required for local development. `pnpm dev` runs the
Worker and dashboard through Wrangler's local mode.

Do not replace pnpm, regenerate the lockfile with another package manager, edit
generated output by hand, or commit `.dev.vars` files.

## Pull Requests

- Keep one logical change per pull request.
- Use a conventional title such as `fix(eval): reject an invalid rollout`.
- Explain the problem, chosen solution, user impact, and compatibility or
  migration implications.
- Add or update tests for behavior changes.
- Add an `Unreleased` changelog entry for user-visible, compatibility, security,
  deployment, or release changes.
- Report the exact validation performed.
- Resolve addressed review conversations before requesting another review.

For non-trivial changes, run the repository autoreview helper:

```bash
.agents/skills/autoreview/scripts/autoreview
```

## Reporting Bugs

Use the bug report form and include:

- the package or application version
- the affected API, SDK, CLI, or dashboard surface
- a minimal reproduction
- expected and actual behavior
- relevant redacted logs

Never include credentials, eval keys, OAuth secrets, private hostnames, personal
paths, customer identifiers, or production flag values.

## Release Process

Maintainers publish application releases from `vX.Y.Z` tags and SDK releases
from `sdk-vX.Y.Z` tags on `main`. SDK publication uses npm trusted publishing;
do not publish from a local machine or add an npm automation token.
