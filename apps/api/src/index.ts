import {
  type EvalResponseBody,
  evaluateFlag,
  type FlagEvaluation,
} from "@openclaw/krillswitch-core";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { getEnvironmentConfig } from "./configCache";

type Bindings = {
  DB: D1Database;
};

const evalRequestSchema = z.object({
  context: z.object({
    key: z.string().min(1),
    attributes: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  }),
});

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

const app = new Hono<{ Bindings: Bindings }>();

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
  return c.json(body);
});

export default app;
