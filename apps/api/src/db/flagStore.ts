import type { FlagConfig, SegmentMap } from "@openclaw/krillswitch-core";
import { eq, inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  environments,
  evalKeys,
  flagEnvironments,
  flags,
  segments,
  variations,
} from "./schema";

export async function resolveEvalEnvironment(
  db: DrizzleD1Database,
  evalKey: string,
): Promise<{ environmentId: string; projectId: string } | null> {
  const row = await db
    .select({
      environmentId: evalKeys.environmentId,
      projectId: environments.projectId,
    })
    .from(evalKeys)
    .innerJoin(environments, eq(evalKeys.environmentId, environments.id))
    .where(eq(evalKeys.key, evalKey))
    .get();
  return row ?? null;
}

/** Segments keyed by segment key, project-wide (segments are env-agnostic). */
export async function loadSegmentMap(
  db: DrizzleD1Database,
  projectId: string,
): Promise<SegmentMap> {
  const rows = await db
    .select({
      key: segments.key,
      contextKeys: segments.contextKeys,
      rules: segments.rules,
    })
    .from(segments)
    .where(eq(segments.projectId, projectId))
    .all();
  const map: SegmentMap = {};
  for (const row of rows) {
    map[row.key] = row;
  }
  return map;
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
