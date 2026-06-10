import type { FlagConfig } from "@openclaw/krillswitch-core";
import { eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { evalKeys, flagEnvironments, flags, variations } from "./schema";

export async function resolveEnvironmentId(
  db: DrizzleD1Database,
  evalKey: string,
): Promise<string | null> {
  const row = await db
    .select({ environmentId: evalKeys.environmentId })
    .from(evalKeys)
    .where(eq(evalKeys.key, evalKey))
    .get();
  return row?.environmentId ?? null;
}

export async function loadFlagConfigs(
  db: DrizzleD1Database,
  environmentId: string,
): Promise<FlagConfig[]> {
  const flagRows = await db
    .select({
      key: flags.key,
      kind: flags.kind,
      flagId: flagEnvironments.flagId,
      enabled: flagEnvironments.enabled,
      offVariationId: flagEnvironments.offVariationId,
      defaultVariationId: flagEnvironments.defaultVariationId,
      targets: flagEnvironments.targets,
      rules: flagEnvironments.rules,
      rollout: flagEnvironments.rollout,
    })
    .from(flagEnvironments)
    .innerJoin(flags, eq(flagEnvironments.flagId, flags.id))
    .where(eq(flagEnvironments.environmentId, environmentId))
    .all();

  if (flagRows.length === 0) {
    return [];
  }

  const variationRows = await db
    .select()
    .from(variations)
    .where(
      inArray(
        variations.flagId,
        flagRows.map((row) => row.flagId),
      ),
    )
    .all();

  return flagRows.map((row) => ({
    key: row.key,
    kind: row.kind,
    enabled: row.enabled,
    variations: variationRows
      .filter((variation) => variation.flagId === row.flagId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((variation) => ({ id: variation.id, value: variation.value })),
    offVariationId: row.offVariationId,
    defaultVariationId: row.defaultVariationId,
    targets: row.targets,
    rules: row.rules,
    rollout: row.rollout,
  }));
}
