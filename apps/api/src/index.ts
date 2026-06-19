import {
  type EvalResponseBody,
  evaluateFlag,
  type FlagEvaluation,
} from "@openclaw/krillswitch-core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { adminRoutes } from "./admin/routes";
import { createAuth } from "./auth/auth";
import { isDevPersonaAuthEnabled } from "./auth/devAuth";
import { getEnvironmentConfig } from "./configCache";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  DEV_AUTH_ENABLED?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
};

const PUBLIC_EVAL_HOST = "flags.openclaw.ai";
const ADMIN_HOST = "switch.openclaw.ai";
const PUBLIC_EVAL_PATH = "/v1/eval";

const evalRequestSchema = z.object({
  context: z.object({
    key: z.string().min(1),
    attributes: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  }),
});

/** Weak ETag over the serialized response so idle polls can 304. */
function evalBodyEtag(serializedBody: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < serializedBody.length; i++) {
    hash ^= serializedBody.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `W/"${(hash >>> 0).toString(16)}"`;
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

const app = new Hono<{ Bindings: Bindings }>();

// Production has two distinct trust boundaries. Keep the public evaluation
// hostname from reaching admin routes or dashboard assets before Cloudflare
// Access has a chance to protect the dashboard hostname.
app.use("*", async (c, next) => {
  const hostname = new URL(c.req.url).hostname;
  const isPublicEvalRequest =
    c.req.path === PUBLIC_EVAL_PATH &&
    (c.req.method === "POST" || c.req.method === "OPTIONS");
  if (
    (hostname === PUBLIC_EVAL_HOST && !isPublicEvalRequest) ||
    (hostname === ADMIN_HOST && c.req.path === PUBLIC_EVAL_PATH)
  ) {
    return c.json({ error: "not_found" }, 404);
  }
  await next();
});

// Eval keys are public flag-set identifiers, not secrets; any browser
// origin may evaluate.
app.use(
  "/v1/*",
  cors({
    origin: "*",
    allowHeaders: ["authorization", "content-type", "if-none-match"],
    // Browsers hide non-safelisted response headers on CORS requests;
    // without this the SDK can never send If-None-Match.
    exposeHeaders: ["ETag", "Server-Timing"],
    // The public eval API has a stable CORS policy, so avoid a preflight
    // round-trip on every browser poll.
    maxAge: 86_400,
  }),
);

// better-auth owns /api/auth/* (session lookup, sign-out, future providers).
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env, {
    devPersonasAllowed: isDevPersonaAuthEnabled(c.env, c.req.url),
  });
  return auth.handler(c.req.raw);
});

app.route("/admin", adminRoutes);

app.post("/v1/eval", async (c) => {
  const requestStart = performance.now();
  const evalKey = bearerToken(c.req.header("authorization"));
  if (!evalKey) {
    return c.json({ error: "missing_eval_key" }, 401);
  }

  const configStart = performance.now();
  const { config, source } = await getEnvironmentConfig(c.env.DB, evalKey);
  const configMs = performance.now() - configStart;
  if (!config) {
    return c.json({ error: "invalid_eval_key" }, 401);
  }

  const parsed = evalRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const { context } = parsed.data;

  // No I/O below: in-isolate timers only advance on I/O, so a 0ms eval
  // duration is itself evidence the hot path never left the isolate.
  const evalStart = performance.now();
  const evaluated: Record<string, FlagEvaluation> = {};
  for (const flagConfig of config.flags) {
    evaluated[flagConfig.key] = evaluateFlag(flagConfig, context);
  }
  const evalMs = performance.now() - evalStart;

  c.header(
    "Server-Timing",
    [
      `cache;desc=${source === "cache" ? "hit" : "miss"}`,
      `config;dur=${configMs.toFixed(3)}`,
      `eval;dur=${evalMs.toFixed(3)}`,
      `total;dur=${(performance.now() - requestStart).toFixed(3)}`,
    ].join(", "),
  );

  const body: EvalResponseBody = { flags: evaluated };
  const serialized = JSON.stringify(body);
  const etag = evalBodyEtag(serialized);
  // Evaluations are personalized by context. The SDK owns its ETag and
  // local-storage cache; shared HTTP/CDN caches must never store this body.
  c.header("Cache-Control", "private, no-store");
  c.header("ETag", etag);
  if (c.req.header("if-none-match") === etag) {
    return c.body(null, 304);
  }
  c.header("content-type", "application/json");
  return c.body(serialized, 200);
});

// `run_worker_first` lets the hostname policy above protect static assets.
// The configured Assets binding retains Cloudflare's SPA fallback behavior.
app.all("*", (c) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return c.json({ error: "not_found" }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
