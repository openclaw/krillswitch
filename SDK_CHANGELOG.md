# SDK changelog

## Unreleased

## 0.0.2 - 2026-10-23

**Highlights:** React flags refresh after reconnecting, and inherited properties no longer interfere with evaluation or manifest defaults.

- Refresh React SDK flags on event-stream connections and reconnections while retaining polling and conditional requests.
- Preserve manifest defaults and ignore inherited JavaScript properties when evaluating flags, segments, and context attributes.

## 0.0.1 - 2026-08-28

### What's Changed
* feat: prepare SDK packages for npm by @jesse-merhi in https://github.com/openclaw/krillswitch/pull/62
* feat(release): publish SDKs through npm OIDC by @vincentkoc in https://github.com/openclaw/krillswitch/pull/80


**Full Changelog**: https://github.com/openclaw/krillswitch/compare/v0.5.0...sdk-v0.0.1
