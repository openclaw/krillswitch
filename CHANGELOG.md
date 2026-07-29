# Changelog

All notable changes to Krillswitch are documented in this file.

## [Unreleased]

## [v0.3.0] - 2026-07-29

### Added

- Complete Connect guidance with copyable SDK examples and live first-request status.

### Fixed

- Derive member roles consistently for Cloudflare Access identities and end Access sessions during sign-out.
- Keep the light dashboard hero legible and table scroll edges visually flat.

### Changed

- Update to Carapace v0.6.0, use its plain identity badges and theme-toggle primitive, and consume the canonical OKLCH application themes without a copied local palette.

## [v0.2.0] - 2026-07-29

### Added

- Production guardrail: saves and toggles in production require a confirm dialog with an audit comment; change-log entries carry optional operator comments end to end.
- Segments: reusable project-scoped audiences (pinned context keys plus attribute rules) referenced from any flag's targeting rules, with typed `segment` evaluation reasons.
- Flag archive lifecycle: archived flags leave the admin list but keep serving evaluations, with restore and full audit coverage.
- Usage analytics: per-environment eval counters and daily request series power SDK-freshness badges, a home usage chart, and per-project and per-flag sparklines.
- Webhooks: admin-managed URLs receive every change-log entry as JSON through a cursor-driven outbox drained after each mutation.
- Command palette (⌘K) over pages, projects, and flags; a Connect page with copyable curl/JavaScript eval snippets and a live first-request status; scoped log-stream viewers on project and flag pages; a tabbed Settings page.

### Changed

- The admin console now consumes the Carapace design system (`@openclaw/carapace`) as a dependency — tokens, themes, and components — with a collapsible navigation rail, the krillswitch brand mark, environment and variation color identity, inline flag toggles, copy-first keys, and a LaunchDarkly-density visual pass across every page.

## [v0.1.2] - 2026-07-27

### Fixed

- Update reusable Cloudflare Access policies through their account-level API so repeat admin deployments remain idempotent.

### Security

- Update React Router to 8.3.0 to resolve its RSC action CSRF bypass advisory.
- Accept verified Cloudflare Access JWTs as production dashboard identities so
  `switch.openclaw.ai` does not require a second GitHub OAuth login after the
  Access gate.
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

[Unreleased]: https://github.com/openclaw/krillswitch/compare/v0.3.0...HEAD
[v0.3.0]: https://github.com/openclaw/krillswitch/compare/v0.2.0...v0.3.0
[v0.2.0]: https://github.com/openclaw/krillswitch/releases/tag/v0.2.0
[v0.1.2]: https://github.com/openclaw/krillswitch/releases/tag/v0.1.2
[v0.1.1]: https://github.com/openclaw/krillswitch/releases/tag/v0.1.1
[v0.1.0]: https://github.com/openclaw/krillswitch/releases/tag/v0.1.0
