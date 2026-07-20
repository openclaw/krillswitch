---
title: Access tokens
description: Mint role-scoped CLI credentials, store them safely, and revoke them cleanly.
---

# Access tokens

## Purpose

Access tokens let the CLI, CI, and coding agents call management routes without a browser session. They begin with `ksat_` and carry either editor or viewer authority.

## Mint

An admin opens **Access → Access tokens**, provides a descriptive name, and selects a role. The plaintext token is returned exactly once.

KrillSwitch stores only a SHA-256 hash, token metadata, creator id, timestamps, and revocation state. Minting writes the token row and audit entry atomically.

## Store

Use `krillswitch onboard` to place the token in OS secure storage. CI should use an approved secret store and inject `KRILLSWITCH_TOKEN` only for the command that needs it.

Never commit a token, paste it into an issue, or reuse it across unrelated environments.

## Revoke

Revocation is idempotent and immediate for subsequent management requests. The revoke mutation and audit entry land atomically. Existing plaintext cannot be recovered; mint a replacement and rotate callers.

## Naming

Use names that identify owner and workload, for example `release-ci-viewer` or `agent-staging-editor`. Clear names make the change log useful and support narrow revocation.
