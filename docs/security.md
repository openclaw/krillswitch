---
title: Security model
description: KrillSwitch trust boundaries, credential classes, storage rules, and failure behavior.
---

# Security model

## Credential classes

| Credential | Secret? | Scope |
| --- | --- | --- |
| Environment eval key `ks_...` | No | Read evaluated flag values for one environment |
| Access token `ksat_...` | Yes | Viewer or editor management routes |
| GitHub OAuth client secret | Yes | Establish human sessions |
| Better Auth secret | Yes | Sign and protect auth state |

Evaluation keys are intentionally browser-embeddable. Never use them as proof of management authority.

## Host isolation

The public hostname exposes only evaluation. The admin hostname rejects evaluation. This boundary exists in Worker code even if a DNS or route configuration changes.

## Secret storage

Worker secrets live in Cloudflare. GitHub Actions receives deploy credentials through repository or environment secrets. The CLI stores access tokens in OS secure storage. D1 stores access-token hashes only.

## Personalized responses

Evaluation depends on context keys and attributes. Responses use `private, no-store`; shared caching risks serving one identity's variation to another. Only configuration is cached inside a Worker isolate.

## Write integrity

Management writes validate their complete semantic state before mutation. State changes and audit rows share a D1 batch. The append-only log is not updated or deleted by application routes.

## Production auth

Development personas require local mode and a loopback host. Production uses GitHub-backed Better Auth sessions. Tokens never receive admin authority.

## Reporting

Report security issues through [GitHub private vulnerability reporting](https://github.com/openclaw/krillswitch/security/advisories/new). Do not include live tokens, OAuth credentials, private flag values, or customer identifiers in public issues.
