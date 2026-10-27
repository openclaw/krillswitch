# Changelog

All notable changes to Krillswitch are documented in this file.

## [Unreleased]

### Security

- Reject non-HTTPS webhook URLs and literal private, metadata, and non-global addresses, and do not follow delivery redirects. A hostname is checked as a name only. Delivery does not pin the address that name resolves to. An already stored unsafe URL stays queued until an admin replaces it. Disabling a webhook does not send an entry again after the subscriber already received it. Thanks @SebTardif.

## [v0.6.1] - 2026-10-26

**Highlights:** Patch the Undici integrity bypass and workerd's compromised-key verifier, with refreshed compatible tooling.

### Security

- Raise the Undici and Zod security overrides to patched versions, unblocking Dependabot security updates for Worker tooling.
- Pin local Worker tooling to workerd 1.20261021.1 to reject compromised eMudhra keys. Thanks @joshavant.

### Changed

- Refresh Carapace, Biome, Vite, Cloudflare types, and CodeQL while preserving the two-day dependency cooldown and Node.js runtime floor. Thanks @dependabot.

## [v0.6.0] - 2026-10-23

**Highlights:** More reliable flag evaluation and React refreshes, bounded CLI and webhook requests, and patched Node.js and tooling security vulnerabilities.

### Fixed

- Use fixed Node.js patches for build, CI, and release tooling to reject the disclosed eMudhra incident keys. Thanks @joshavant.

- Refresh React SDK flag values when an event stream connects or reconnects, including changes missed while disconnected.
- Keep inherited JavaScript properties out of segment lookup, attribute targeting, and SDK defaults so keys such as `constructor` do not crash evaluation or select unintended values.
- Apply project segment rules on operator flag evaluation, so the same context matches the public eval result. Thanks @SebTardif.
- Strip a trailing slash from the React event-stream URL so a base URL ending in `/` connects to `/v1/stream`. Thanks @SebTardif.
- Bound GitHub organization membership checks to five seconds during sign-in, including response-body reads, while preserving cached membership on network failure. Thanks @SebTardif.
- Abort webhook deliveries after two seconds, record timeout status, and keep unattempted entries queued without delaying other subscribers. Thanks @SebTardif.
- Abort CLI API requests and response-body reads after a new 30-second default deadline, report timeout errors clearly, and support `KRILLSWITCH_TIMEOUT_MS` overrides (`0` restores unlimited waits). Thanks @SebTardif.
- Honor CLI token overrides without accessing OS secure storage, so `--token` and `KRILLSWITCH_TOKEN` still work when the keychain is unavailable.

### Added

- Published `@openclaw/krillswitch-core` and
  `@openclaw/krillswitch-react` v0.0.1 in lockstep from the protected
  `sdk-v0.0.1` tag through retained, integrity-checked tarballs and npm trusted
  publishing.

### Changed

- Refresh compatible application, Cloudflare tooling, and jsdom dependencies while keeping Better Auth's schema generator aligned with the runtime and retaining the two-day dependency cooldown. Thanks @dependabot.
- Refresh Better Auth, TanStack Query, Vitest, and CodeQL while keeping the auth schema generator aligned with its runtime and preserving the runtime floor and two-day dependency cooldown. Thanks @dependabot.
- Authenticate ClawSweeper dispatch with short-lived GitHub OIDC tokens instead of stored App credentials, preserving independent webhook delivery and retryable intake failures.
- Run native macOS keyring compatibility on the Apple Silicon macOS 27 runner.
- Refresh React and Better Auth patch versions, keeping the auth schema generator aligned with the runtime and checking OAuth membership, failed writes, and session revocation against local D1 (thanks @vincentkoc).
- Refresh the Cloudflare Vitest plugin, Workers types, and Wrangler together while preserving the Node.js floor and two-day dependency cooldown.
- Upgrade the CLI secure-storage binding to keyring 2: unavailable or unreadable credentials now report an error instead of appearing absent. Explicit `--token` and `KRILLSWITCH_TOKEN` overrides bypass secure storage.
- Refresh Vite, Cloudflare test tooling, Wrangler, and Node.js types while preserving the existing runtime floor and dependency cooldown.
- Reject oversized segment context-key and flag variation arrays before parsing their entries, retaining the existing 500-key and 20-variation limits.

- Validate the application package version before creating release archives.

- Add signed-tag application releases and no-publish SDK rehearsals with retained tarballs, changelog notes, and checksums.

- Refresh Hono, Radix, Vite, Cloudflare tooling, and GitHub Actions within compatible versions while preserving the Node.js floor and two-day dependency cooldown.

- Use one shared autoreview installation from `openclaw/agent-skills`; repository entrypoints receive upstream fixes without copied helpers or tests.
- Refresh compatible application and development dependencies and CodeQL pins, keeping the Better Auth schema generator aligned with its runtime and preserving the Node.js floor and two-day dependency cooldown.
- Refresh workspace dependencies and GitHub Actions pins, including pnpm 11.24, Carapace 0.6.2, and Cloudflare's renamed Vitest plugin while retaining the two-day dependency release cooldown.

### Security

- Require Sharp 0.35.5 and source-map-js 1.2.2 to address GHSA-wq5f-xc86-pv6w and GHSA-68fv-2mgg-jv7q while preserving the dependency cooldown.
- Update Sharp to 0.35.4 and require the patched version in dependency overrides to address libheif advisory GHSA-rgj7-g3m4-5g8c.
- Require patched Undici 7.29.1 and 8.10.2 in tooling dependencies so exact transitive pins cannot block security updates; retain the two-day release cooldown.

## [v0.5.0] - 2026-07-30

### Added

- Let server-rendered React applications evaluate manifest-typed flags before rendering and hydrate with the same bootstrap values.

### Fixed

- Prevent touch interactions from leaving persistent hover tint on dashboard table rows.

## [v0.4.0] - 2026-07-29

### Added

- Serve OpenFeature Remote Evaluation Protocol (OFREP) single and bulk evaluations through the public Worker, including ETag and CORS support.
- Support negation, string, numeric, semantic-version, and date operators in flag and segment targeting rules.
- Stream configuration changes over server-sent events and let the React SDK opt in to immediate refetches when changes arrive.
- Mark flags as permanent, surface stale temporary flags in the dashboard, and scan source trees for flag-key references with the CLI.

### Fixed

- Keep dashboard navigation and layouts usable in mobile webviews, including safe-area spacing and compact rule controls.

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

[Unreleased]: https://github.com/openclaw/krillswitch/compare/v0.6.1...HEAD
[v0.6.1]: https://github.com/openclaw/krillswitch/compare/v0.6.0...v0.6.1
[v0.6.0]: https://github.com/openclaw/krillswitch/compare/v0.5.0...v0.6.0
[v0.5.0]: https://github.com/openclaw/krillswitch/compare/v0.4.0...v0.5.0
[v0.4.0]: https://github.com/openclaw/krillswitch/compare/v0.3.0...v0.4.0
[v0.3.0]: https://github.com/openclaw/krillswitch/compare/v0.2.0...v0.3.0
[v0.2.0]: https://github.com/openclaw/krillswitch/releases/tag/v0.2.0
[v0.1.2]: https://github.com/openclaw/krillswitch/releases/tag/v0.1.2
[v0.1.1]: https://github.com/openclaw/krillswitch/releases/tag/v0.1.1
[v0.1.0]: https://github.com/openclaw/krillswitch/releases/tag/v0.1.0
