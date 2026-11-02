---
title: HTTP API
description: Call the public evaluation endpoint and understand its cache, CORS, and response contracts.
---

# HTTP API

## Evaluate flags

```http
POST /v1/eval
Authorization: Bearer ks_env_...
Content-Type: application/json
```

```json
{
  "context": {
    "key": "user-123",
    "attributes": {
      "role": "admin",
      "plan": "pro"
    }
  }
}
```

The response contains every configured flag in the environment:

```json
{
  "flags": {
    "new_nav": {
      "value": true,
      "variationId": "var_new_nav_on",
      "reason": { "kind": "rule", "attribute": "role" }
    }
  }
}
```

## Status codes

| Status | Meaning |
| --- | --- |
| `200` | Evaluated successfully |
| `304` | Response matches `If-None-Match` |
| `400` | Invalid request body |
| `401` | Missing or invalid evaluation key |
| `404` | Route unavailable on this host |

## Cache and timing headers

Responses send `Cache-Control: private, no-store`. Evaluations depend on context, so shared CDN or HTTP caches must not store them.

The weak `ETag` covers the serialized response. Browsers may send it as `If-None-Match`; the React SDK does this automatically.

`Server-Timing` reports configuration cache hit or miss, configuration load duration, pure evaluation duration, and total Worker duration.

## CORS

The public eval path accepts any browser origin because evaluation keys are public environment identifiers. CORS exposes `ETag` and `Server-Timing`, and browsers cache preflight policy for one day.

## OpenFeature providers (OFREP)

Krillswitch also implements the [OpenFeature Remote Evaluation Protocol](https://openfeature.dev/docs/reference/other-technologies/ofrep/):

- `POST /ofrep/v1/evaluate/flags/:key` evaluates one flag (server providers).
- `POST /ofrep/v1/evaluate/flags` evaluates all flags (web providers), with ETag/304 revalidation.

Configure official providers with the **origin `https://flags.openclaw.ai`**, not `/v1/eval` or an appended `/ofrep`: the providers add the protocol path. For local development use `http://localhost:8799`. Send the environment's evaluation key as `Authorization: Bearer ks_env_...`, not a management access token or dashboard session. Evaluation keys identify public flag sets; never place secrets in flag values or context.

OFREP context requires a nonempty, stable `targetingKey` for deterministic targeting and rollout assignments. Additional attributes are **flat primitives** (`string`, `number`, `boolean`), for example `{ targetingKey: "user-123", plan: "pro", role: "admin" }`. Do not nest them under `attributes` as with the native API; arrays, objects, and null attributes are ignored.

### Server-side JavaScript

Install the official packages in your application (Krillswitch does not bundle a provider):

```sh
npm install @openfeature/server-sdk @openfeature/ofrep-provider
```

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { OFREPProvider } from "@openfeature/ofrep-provider";

const evalKey = process.env.KRILLSWITCH_EVAL_KEY;
if (!evalKey) throw new Error("KRILLSWITCH_EVAL_KEY is required");

await OpenFeature.setProviderAndWait(new OFREPProvider({
  baseUrl: "https://flags.openclaw.ai",
  headers: { Authorization: `Bearer ${evalKey}` },
}));
const client = OpenFeature.getClient();
const context = { targetingKey: "user-123", plan: "pro" };
const souls = await client.getBooleanDetails("souls", false, context);
const theme = await client.getStringValue("theme", "light", context);
// For your own number/JSON flags, use matching defaults:
const limit = await client.getNumberValue("request-limit", 10, context);
const layout = await client.getObjectValue("layout", { compact: false }, context);
```

### Browser JavaScript

```sh
npm install @openfeature/web-sdk @openfeature/ofrep-web-provider
```

```ts
import { OpenFeature } from "@openfeature/web-sdk";
import { OFREPWebProvider } from "@openfeature/ofrep-web-provider";

await OpenFeature.setProviderAndWait(new OFREPWebProvider({
  baseUrl: "https://flags.openclaw.ai",
  headers: { Authorization: "Bearer ks_env_..." }, // Your environment eval key.
  pollInterval: 30_000, // Milliseconds; enable refreshes explicitly.
}), { targetingKey: "user-123", plan: "pro" });
const client = OpenFeature.getClient();
const souls = client.getBooleanDetails("souls", false);
const theme = client.getStringValue("theme", "light");
// When identity or targeting attributes change, await the new evaluation:
await OpenFeature.setContext({ targetingKey: "user-456", plan: "free" });
```

These class names, options, and signatures follow the official [server provider](https://github.com/open-feature/js-sdk-contrib/tree/main/libs/providers/ofrep), [web provider](https://github.com/open-feature/js-sdk-contrib/tree/main/libs/providers/ofrep-web), and [JavaScript SDK](https://github.com/open-feature/js-sdk) sources. The server SDK is asynchronous and accepts per-call context; the web SDK evaluates its fetched flag set synchronously and refreshes when its context changes.

### Per-flag errors and safe defaults

Always supply an application-safe default matching the flag type. Inspect the SDK's details (`value`, `reason`, `errorCode`, `errorMessage`) when diagnosing a fallback; a returned `false` alone does not distinguish a disabled flag from an evaluation error.

For degraded stored configuration, such as a reference to a missing variation, a single-flag request returns HTTP `400` with a sanitized keyed `GENERAL` failure. Bulk evaluation remains HTTP `200` with mixed results:

```json
{
  "flags": [
    { "key": "souls", "errorCode": "GENERAL", "errorDetails": "Flag evaluation failed." },
    { "key": "theme", "value": "dark", "reason": "TARGETING_MATCH", "variant": "var_theme_dark" }
  ]
}
```

Official providers use the supplied code default for the failed flag while healthy flags remain usable. They do not receive internal exception messages or variation references for failures. This isolation is a degraded-configuration safeguard, not a replacement for admin write validation; request-wide authentication, context, or storage failures remain request-wide.

Bulk ETags cover the complete mix of successes and failures. An unchanged mix can return `304`; corrected configuration produces a new result after the Worker's short configuration-cache refresh window, so polling clients can recover. Responses remain `Cache-Control: private, no-store`; the provider owns its local cache. This does not change the native `/v1/eval` contract or disabled off-variation precedence.

## Host boundary

Production evaluation lives at `https://flags.openclaw.ai`. Public evaluation accepts `POST` and `OPTIONS` on `/v1/eval` and the OFREP evaluation paths, plus `GET` on `/v1/stream` for change signals. Dashboard assets, auth, and `/admin/*` return 404.

The management API lives under `/admin/*` on `https://switch.openclaw.ai`, behind Cloudflare Access. Its routes are intended for the dashboard and CLI, not as a stable third-party API.
