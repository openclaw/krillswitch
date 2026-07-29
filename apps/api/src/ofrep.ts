import {
  type AttributeValue,
  type EvalContext,
  evaluateFlag,
  type FlagEvaluation,
} from "@openclaw/krillswitch-core";
import { Hono } from "hono";
import { getEnvironmentConfig } from "./configCache";
import {
  bearerToken,
  evalBodyEtag,
  matchesEtag,
  recordEvalStats,
} from "./evalShared";

/** OpenFeature Remote Evaluation Protocol (OFREP) endpoints:
 *  POST /ofrep/v1/evaluate/flags       — bulk, with ETag/304
 *  POST /ofrep/v1/evaluate/flags/:key  — single flag
 *  Auth is the same public eval key as /v1/eval; `targetingKey` maps to the
 *  native context key and the remaining context properties become
 *  attributes. Spec: https://github.com/open-feature/protocol */

type Bindings = {
  DB: D1Database;
};

/** OpenFeature resolution reasons for our native reason kinds. Every
 *  targeting-derived match (target, rule, segment) is TARGETING_MATCH. */
const OFREP_REASONS: Record<FlagEvaluation["reason"]["kind"], string> = {
  off: "DISABLED",
  target: "TARGETING_MATCH",
  rule: "TARGETING_MATCH",
  segment: "TARGETING_MATCH",
  rollout: "SPLIT",
  default: "DEFAULT",
};

interface OfrepSuccess {
  key: string;
  value: FlagEvaluation["value"];
  reason: string;
  variant: string;
}

function toOfrep(key: string, evaluation: FlagEvaluation): OfrepSuccess {
  return {
    key,
    value: evaluation.value,
    reason: OFREP_REASONS[evaluation.reason.kind],
    variant: evaluation.variationId,
  };
}

function isAttributeValue(value: unknown): value is AttributeValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** OFREP context → native EvalContext. `targetingKey` is required (rollout
 *  bucketing needs a stable identity); non-primitive attributes are dropped
 *  because targeting rules only compare primitives. */
function parseOfrepContext(
  body: unknown,
): { context: EvalContext } | { errorCode: string; errorDetails: string } {
  if (typeof body !== "object" || body === null) {
    return {
      errorCode: "INVALID_CONTEXT",
      errorDetails: "Request body must be a JSON object with a context.",
    };
  }
  const context = (body as { context?: unknown }).context;
  if (typeof context !== "object" || context === null) {
    return {
      errorCode: "INVALID_CONTEXT",
      errorDetails: "context must be an object.",
    };
  }
  const { targetingKey, ...rest } = context as Record<string, unknown>;
  if (typeof targetingKey !== "string" || targetingKey.length === 0) {
    return {
      errorCode: "TARGETING_KEY_MISSING",
      errorDetails: "context.targetingKey is required.",
    };
  }
  const attributes: Record<string, AttributeValue> = {};
  for (const [name, value] of Object.entries(rest)) {
    if (isAttributeValue(value)) attributes[name] = value;
  }
  return { context: { key: targetingKey, attributes } };
}

export const ofrepRoutes = new Hono<{ Bindings: Bindings }>();

ofrepRoutes.post("/v1/evaluate/flags/:key?", async (c) => {
  const evalKey = bearerToken(c.req.header("authorization"));
  if (!evalKey) {
    return c.json(
      { errorCode: "GENERAL", errorDetails: "Missing bearer eval key." },
      401,
    );
  }
  const { config } = await getEnvironmentConfig(c.env.DB, evalKey);
  if (!config) {
    return c.json(
      { errorCode: "GENERAL", errorDetails: "Unknown eval key." },
      401,
    );
  }

  const parsed = parseOfrepContext(await c.req.json().catch(() => null));
  if ("errorCode" in parsed) {
    return c.json(parsed, 400);
  }
  const { context } = parsed;

  c.executionCtx.waitUntil(recordEvalStats(c.env.DB, config.environmentId));
  c.header("Cache-Control", "private, no-store");

  const flagKey = c.req.param("key");
  if (flagKey !== undefined) {
    const flagConfig = config.flags.find((flag) => flag.key === flagKey);
    if (!flagConfig) {
      return c.json(
        {
          key: flagKey,
          errorCode: "FLAG_NOT_FOUND",
          errorDetails: `Flag ${flagKey} does not exist in this environment.`,
        },
        404,
      );
    }
    return c.json(
      toOfrep(flagKey, evaluateFlag(flagConfig, context, config.segments)),
      200,
    );
  }

  const flags = config.flags.map((flagConfig) =>
    toOfrep(
      flagConfig.key,
      evaluateFlag(flagConfig, context, config.segments),
    ),
  );
  const serialized = JSON.stringify({ flags });
  const etag = evalBodyEtag(serialized);
  c.header("ETag", etag);
  if (matchesEtag(c.req.header("if-none-match"), etag)) {
    return c.body(null, 304);
  }
  c.header("content-type", "application/json");
  return c.body(serialized, 200);
});
