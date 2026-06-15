import type {
  AttributeValue,
  FlagEvaluation,
} from "@openclaw/krillswitch-core";
import { flagAll, type ParsedArgs, requireFlag } from "../args";
import type { KrillswitchClient } from "../client";
import { type Column, cell, printJson, printTable, wantsJson } from "../output";

/** "true"/"false"/numeric coerce to typed values; everything else stays text. */
function coerceAttribute(raw: string): AttributeValue {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const numeric = Number(raw);
  if (raw.trim() !== "" && !Number.isNaN(numeric)) return numeric;
  return raw;
}

function attributesFrom(args: ParsedArgs): Record<string, AttributeValue> {
  const attributes: Record<string, AttributeValue> = {};
  for (const entry of flagAll(args, "attr")) {
    const [name, ...rest] = entry.split("=");
    if (name && rest.length > 0) {
      attributes[name] = coerceAttribute(rest.join("="));
    }
  }
  return attributes;
}

type EvalRow = { key: string; evaluation: FlagEvaluation };

const COLUMNS: Column<EvalRow>[] = [
  { header: "FLAG", value: (r) => r.key },
  { header: "VALUE", value: (r) => cell(r.evaluation.value) },
  { header: "REASON", value: (r) => r.evaluation.reason.kind },
];

export async function evalContext(
  client: KrillswitchClient,
  args: ParsedArgs,
): Promise<void> {
  const project = requireFlag(args, "project");
  const env = requireFlag(args, "env");
  const key = requireFlag(args, "key");
  const attributes = attributesFrom(args);

  const { flags } = await client.request<{
    flags: Record<string, FlagEvaluation>;
  }>(
    `/admin/projects/${encodeURIComponent(project)}/environments/${encodeURIComponent(env)}/eval`,
    {
      method: "POST",
      body: {
        context: {
          key,
          ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
        },
      },
    },
  );

  if (wantsJson(args)) {
    printJson({ flags });
    return;
  }
  const rows = Object.entries(flags).map(([flagKey, evaluation]) => ({
    key: flagKey,
    evaluation,
  }));
  printTable(rows, COLUMNS);
}
