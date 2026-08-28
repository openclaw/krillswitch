---
title: Core SDK
description: Use the pure TypeScript evaluator and shared flag contracts without network or framework dependencies.
---

# Core SDK

`@openclaw/krillswitch-core` contains the wire types, flag model, rollout hash, and pure `evaluateFlag` function. It performs no I/O and has no framework dependency.

## Install

```sh
npm install @openclaw/krillswitch-core
```

## Evaluate one flag

```ts
import { evaluateFlag, type FlagConfig } from "@openclaw/krillswitch-core";

const flag: FlagConfig = {
  key: "new_nav",
  kind: "boolean",
  enabled: true,
  variations: [
    { id: "off", value: false },
    { id: "on", value: true },
  ],
  offVariationId: "off",
  defaultVariationId: "off",
  targets: [],
  rules: [],
  rollout: {
    variations: [
      { variationId: "on", weight: 10 },
      { variationId: "off", weight: 90 },
    ],
  },
};

const result = evaluateFlag(flag, { key: "user-123" });
```

The result contains `value`, `variationId`, and a structured reason.

## Valid configuration

Write paths validate that referenced variations exist, values match the flag kind, and rollout weights total 100. The evaluator still fails loudly if handed corrupt in-memory configuration rather than silently serving an arbitrary value.

## When to use it

- server-side evaluation from configuration you already loaded;
- unit tests for targeting behavior;
- shared types around the HTTP evaluation contract;
- custom framework adapters.

Browser applications normally use the [React SDK](react-sdk.md) or call the [HTTP API](api.md).
