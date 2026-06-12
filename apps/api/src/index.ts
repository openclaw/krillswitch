import {
  type EvalResponseBody,
  evaluateFlag,
  type FlagEvaluation,
} from "@openclaw/krillswitch-core";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { adminRoutes } from "./admin/routes";
import { createAuth } from "./auth/auth";
import { isDevPersonaAuthEnabled } from "./auth/devAuth";
import { getEnvironmentConfig } from "./configCache";

type Bindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  DEV_AUTH_ENABLED?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
};

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
  const { config, source } = await getEnvironmentConfig(
    drizzle(c.env.DB),
    evalKey,
  );
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
  c.header("ETag", etag);
  if (c.req.header("if-none-match") === etag) {
    return c.body(null, 304);
  }
  c.header("content-type", "application/json");
  return c.body(serialized, 200);
});

export default app;
