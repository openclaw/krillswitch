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

## Host boundary

Production evaluation lives at `https://flags.openclaw.ai`. Only `POST` and `OPTIONS` on `/v1/eval` are exposed there. Dashboard assets, auth, and `/admin/*` return 404.

The management API lives under `/admin/*` on `https://switch.openclaw.ai`, behind Cloudflare Access. Its routes are intended for the dashboard and CLI, not as a stable third-party API.
