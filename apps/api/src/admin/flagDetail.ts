import type {
  FlagKind,
  FlagValue,
  Rollout,
  TargetingRule,
  UserTarget,
} from "@openclaw/krillswitch-core";
import { and, eq, ne } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  environments,
  flagEnvironments,
  flags,
  variations,
} from "../db/schema";
import type { FlagCreate, FlagDetailUpdate } from "./flagDetailSchema";

export type FlagDetail = {
  flag: {
    id: string;
    key: string;
    name: string;
    kind: FlagKind;
    description: string | null;
  };
  variations: {
    id: string;
    value: FlagValue;
    name: string | null;
    sortOrder: number;
  }[];
  config: {
    enabled: boolean;
    offVariationId: string;
    defaultVariationId: string;
    targets: UserTarget[];
    rules: TargetingRule[];
    rollout: Rollout | null;
  };
};

export type UpdateOutcome =
  | { kind: "ok"; detail: FlagDetail }
  | { kind: "not_found" }
  | { kind: "invalid"; message: string }
  | { kind: "variation_in_use"; message: string };

async function loadFlagRow(
  db: DrizzleD1Database,
  projectId: string,
  flagKey: string,
) {
  return db
    .select()
    .from(flags)
    .where(and(eq(flags.projectId, projectId), eq(flags.key, flagKey)))
    .get();
}

export async function loadFlagDetail(
  db: DrizzleD1Database,
  options: { projectId: string; environmentId: string; flagKey: string },
): Promise<FlagDetail | null> {
  const flag = await loadFlagRow(db, options.projectId, options.flagKey);
  if (!flag) {
    return null;
  }
  const config = await db
    .select()
    .from(flagEnvironments)
    .where(
      and(
        eq(flagEnvironments.flagId, flag.id),
        eq(flagEnvironments.environmentId, options.environmentId),
      ),
    )
    .get();
  if (!config) {
    return null;
  }
  const variationRows = await db
    .select()
    .from(variations)
    .where(eq(variations.flagId, flag.id))
    .all();
  return {
    flag,
    variations: variationRows.sort((a, b) => a.sortOrder - b.sortOrder),
    config: {
      enabled: config.enabled,
      offVariationId: config.offVariationId,
      defaultVariationId: config.defaultVariationId,
      targets: config.targets,
      rules: config.rules,
      rollout: config.rollout,
    },
  };
}

function configReferencesVariation(
  config: {
    offVariationId: string;
    defaultVariationId: string;
    targets: UserTarget[];
    rules: TargetingRule[];
    rollout: Rollout | null;
  },
  variationId: string,
): boolean {
  return (
    config.offVariationId === variationId ||
    config.defaultVariationId === variationId ||
    config.targets.some((target) => target.variationId === variationId) ||
    config.rules.some((rule) => rule.variationId === variationId) ||
    (config.rollout?.variations ?? []).some(
      (rolloutVariation) => rolloutVariation.variationId === variationId,
    )
  );
}

export async function updateFlagDetail(
  db: DrizzleD1Database,
  options: {
    projectId: string;
    environmentId: string;
    flagKey: string;
    draft: FlagDetailUpdate;
  },
): Promise<UpdateOutcome> {
  const { draft } = options;
  const flag = await loadFlagRow(db, options.projectId, options.flagKey);
  if (!flag) {
    return { kind: "not_found" };
  }
  const existing = await db
    .select()
    .from(variations)
    .where(eq(variations.flagId, flag.id))
    .all();
  const existingIds = new Set(existing.map((variation) => variation.id));

  for (const variation of draft.variations) {
    if (variation.id && !existingIds.has(variation.id)) {
      return {
        kind: "invalid",
        message: "a variation id does not belong to this flag",
      };
    }
  }

  const keptIds = new Set(
    draft.variations.flatMap((variation) =>
      variation.id ? [variation.id] : [],
    ),
  );
  const removedIds = [...existingIds].filter((id) => !keptIds.has(id));

  if (removedIds.length > 0) {
    const otherConfigs = await db
      .select()
      .from(flagEnvironments)
      .where(
        and(
          eq(flagEnvironments.flagId, flag.id),
          ne(flagEnvironments.environmentId, options.environmentId),
        ),
      )
      .all();
    for (const removedId of removedIds) {
      const blocking = otherConfigs.find((config) =>
        configReferencesVariation(config, removedId),
      );
      if (blocking) {
        const environment = await db
          .select({ name: environments.name })
          .from(environments)
          .where(eq(environments.id, blocking.environmentId))
          .get();
        return {
          kind: "variation_in_use",
          message: `a removed variation is still used by the ${environment?.name ?? "another"} environment`,
        };
      }
    }
  }

  const resolvedIds = draft.variations.map(
    (variation) => variation.id ?? `var_${crypto.randomUUID()}`,
  );

  const statements = [];
  for (const removedId of removedIds) {
    statements.push(db.delete(variations).where(eq(variations.id, removedId)));
  }
  for (const [index, variation] of draft.variations.entries()) {
    const id = resolvedIds[index];
    if (id === undefined) continue;
    if (variation.id) {
      statements.push(
        db
          .update(variations)
          .set({
            value: variation.value,
            name: variation.name ?? null,
            sortOrder: index,
          })
          .where(eq(variations.id, id)),
      );
    } else {
      statements.push(
        db.insert(variations).values({
          id,
          flagId: flag.id,
          value: variation.value,
          name: variation.name ?? null,
          sortOrder: index,
        }),
      );
    }
  }

  const indexToId = (index: number) => {
    const id = resolvedIds[index];
    if (id === undefined) {
      throw new Error("variation index out of range after validation");
    }
    return id;
  };

  statements.push(
    db
      .update(flagEnvironments)
      .set({
        enabled: draft.enabled,
        offVariationId: indexToId(draft.offVariationIndex),
        defaultVariationId: indexToId(draft.defaultVariationIndex),
        targets: draft.targets.map((target) => ({
          variationId: indexToId(target.variationIndex),
          contextKeys: target.contextKeys,
        })),
        rules: draft.rules.map((rule) => ({
          variationId: indexToId(rule.variationIndex),
          attribute: rule.attribute,
          values: rule.values,
        })),
        rollout: draft.rollout
          ? {
              variations: draft.rollout.variations.map((rolloutVariation) => ({
                variationId: indexToId(rolloutVariation.variationIndex),
                weight: rolloutVariation.weight,
              })),
            }
          : null,
      })
      .where(
        and(
          eq(flagEnvironments.flagId, flag.id),
          eq(flagEnvironments.environmentId, options.environmentId),
        ),
      ),
  );

  const [first, ...rest] = statements;
  if (first) {
    await db.batch([first, ...rest]);
  }

  const detail = await loadFlagDetail(db, options);
  if (!detail) {
    return { kind: "not_found" };
  }
  return { kind: "ok", detail };
}

export type CreateOutcome =
  | { kind: "ok" }
  | { kind: "duplicate_key" }
  | { kind: "invalid"; message: string };

export async function createFlag(
  db: DrizzleD1Database,
  options: { projectId: string; draft: FlagCreate },
): Promise<CreateOutcome> {
  const { draft } = options;
  const existing = await loadFlagRow(db, options.projectId, draft.key);
  if (existing) {
    return { kind: "duplicate_key" };
  }
  const environmentRows = await db
    .select({ id: environments.id })
    .from(environments)
    .where(eq(environments.projectId, options.projectId))
    .all();
  if (environmentRows.length === 0) {
    return { kind: "invalid", message: "the project has no environments" };
  }

  const flagId = `flag_${crypto.randomUUID()}`;
  const variationIds = draft.variations.map(() => `var_${crypto.randomUUID()}`);
  const indexToId = (index: number) => {
    const id = variationIds[index];
    if (id === undefined) {
      throw new Error("variation index out of range after validation");
    }
    return id;
  };

  const statements = [
    db.insert(flags).values({
      id: flagId,
      projectId: options.projectId,
      key: draft.key,
      name: draft.name,
      kind: draft.kind,
      description: draft.description ?? null,
    }),
    ...draft.variations.map((variation, index) =>
      db.insert(variations).values({
        id: indexToId(index),
        flagId,
        value: variation.value,
        name: variation.name ?? null,
        sortOrder: index,
      }),
    ),
    ...environmentRows.map((environment) =>
      db.insert(flagEnvironments).values({
        id: `fe_${crypto.randomUUID()}`,
        flagId,
        environmentId: environment.id,
        enabled: draft.enabled,
        offVariationId: indexToId(draft.offVariationIndex),
        defaultVariationId: indexToId(draft.defaultVariationIndex),
        targets: [],
        rules: [],
        rollout: null,
      }),
    ),
  ] as const;
  await db.batch([statements[0], ...statements.slice(1)]);
  return { kind: "ok" };
}

export async function deleteFlag(
  db: DrizzleD1Database,
  options: { projectId: string; flagKey: string },
): Promise<boolean> {
  const flag = await loadFlagRow(db, options.projectId, options.flagKey);
  if (!flag) {
    return false;
  }
  await db.batch([
    db.delete(flagEnvironments).where(eq(flagEnvironments.flagId, flag.id)),
    db.delete(variations).where(eq(variations.flagId, flag.id)),
    db.delete(flags).where(eq(flags.id, flag.id)),
  ]);
  return true;
}
