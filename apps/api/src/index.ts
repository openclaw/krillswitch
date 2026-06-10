import {
  type EvalResponseBody,
  evaluateFlag,
  type FlagEvaluation,
} from "@openclaw/krillswitch-core";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { loadFlagConfigs, resolveEnvironmentId } from "./db/flagStore";

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
  const evalKey = bearerToken(c.req.header("authorization"));
  if (!evalKey) {
    return c.json({ error: "missing_eval_key" }, 401);
  }

  const db = drizzle(c.env.DB);
  const environmentId = await resolveEnvironmentId(db, evalKey);
  if (!environmentId) {
    return c.json({ error: "invalid_eval_key" }, 401);
  }

  const parsed = evalRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const { context } = parsed.data;

  const configs = await loadFlagConfigs(db, environmentId);
  const evaluated: Record<string, FlagEvaluation> = {};
  for (const config of configs) {
    evaluated[config.key] = evaluateFlag(config, context);
  }

  const body: EvalResponseBody = { flags: evaluated };
  return c.json(body);
});

export default app;
