# Changelog

All notable changes to Krillswitch are documented in this file.

## [Unreleased]

### Fixed

- Update reusable Cloudflare Access policies through their account-level API so repeat admin deployments remain idempotent.

### Security

- Default the admin Cloudflare Access policy to the OpenClaw GitHub organization instead of the `openclaw.ai` email domain.

## [v0.1.1] - 2026-07-15

### Fixed

- Record access-token mint and revoke operations in the atomic audit trail without storing plaintext tokens.
- Honor CLI change-log limits and normalize configured API origins before appending request paths.
- Publish the dashboard and evaluation Worker through Cloudflare Custom Domains so their DNS records and certificates are managed automatically.

### Changed

- Update workspace and GitHub Actions dependencies, including TypeScript 7, React Router 8, and the Node.js 22.22 minimum required by the updated toolchain.
- Add the full Markdown documentation site at `krillswitch.com` with GitHub Pages deployment, searchable navigation, operator guides, SDK references, and production runbooks.
- Publish the repository under the MIT license with public source, contribution workflows, and GitHub-native security reporting.

### Security

- Update and override vulnerable transitive tooling dependencies so the workspace audit reports no known advisories.
- Enable real CodeQL analysis, secret scanning, push protection, and private vulnerability reporting for the public repository.

## [v0.1.0] - 2026-06-19

### Added

- Self-hosted feature flag evaluation on Cloudflare Workers with D1-backed
  configuration, in-isolate caching, ETags, and `Server-Timing` telemetry.
- An admin dashboard for projects, environments, flags, targeting rules,
  rollout variations, access tokens, role grants, and an append-only change
  log.
- Typed core evaluation and React SDK packages, plus a CLI for reading and
  managing flags, projects, and access credentials.
- Cloudflare deployment automation, Access provisioning, GitHub CI, CodeQL,
  Dependabot, stale issue management, and code ownership.

### Security

- Enforce that at least one administrator remains through D1 role-change
  guards and audited role updates.
- Scope Cloudflare Access provisioning to an exact application id and root
  hostname, rejecting ambiguous or path-scoped applications.
- Protect role-scoped API tokens, GitHub organization-derived viewer access,
  and Cloudflare Access service-token credentials.

### Changed

- Standardize local development, CI, and deployment commands on pnpm.

[Unreleased]: https://github.com/openclaw/krillswitch/compare/v0.1.1...HEAD
[v0.1.1]: https://github.com/openclaw/krillswitch/releases/tag/v0.1.1
[v0.1.0]: https://github.com/openclaw/krillswitch/releases/tag/v0.1.0
