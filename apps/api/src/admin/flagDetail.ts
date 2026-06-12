import type {
  FlagKind,
  FlagValue,
  JsonValue,
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
import {
  type Actor,
  changedFields,
  changeLogInsert,
  snapshot,
} from "./changeLog";
import type { FlagCreate, FlagDetailUpdate } from "./flagDetailSchema";

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    actor: Actor;
    projectKey: string;
    environmentKey: string;
  },
): Promise<UpdateOutcome> {
  const { draft } = options;
  const flag = await loadFlagRow(db, options.projectId, options.flagKey);
  if (!flag) {
    return { kind: "not_found" };
  }
  const beforeDetail = await loadFlagDetail(db, options);
  if (!beforeDetail) {
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

  const newConfig = {
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
  };

  statements.push(
    db
      .update(flagEnvironments)
      .set(newConfig)
      .where(
        and(
          eq(flagEnvironments.flagId, flag.id),
          eq(flagEnvironments.environmentId, options.environmentId),
        ),
      ),
  );

  const beforeSnapshot = snapshot({
    ...beforeDetail.config,
    variations: beforeDetail.variations.map((variation) => ({
      value: variation.value,
      name: variation.name,
    })),
  });
  const afterSnapshot = snapshot({
    ...newConfig,
    variations: draft.variations.map((variation) => ({
      value: variation.value,
      name: variation.name ?? null,
    })),
  });
  const diff = changedFields(
    isRecord(beforeSnapshot) ? beforeSnapshot : {},
    isRecord(afterSnapshot) ? afterSnapshot : {},
  );
  statements.push(
    changeLogInsert(db, {
      actor: options.actor,
      action: "flag.update",
      projectKey: options.projectKey,
      flagKey: options.flagKey,
      target: `${options.projectKey}/${options.environmentKey}/${options.flagKey}`,
      before: diff.before,
      after: diff.after,
    }),
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
  options: {
    projectId: string;
    draft: FlagCreate;
    actor: Actor;
    projectKey: string;
  },
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
    changeLogInsert(db, {
      actor: options.actor,
      action: "flag.create",
      projectKey: options.projectKey,
      flagKey: draft.key,
      target: `${options.projectKey}/${draft.key}`,
      after: snapshot({
        key: draft.key,
        name: draft.name,
        kind: draft.kind,
        enabled: draft.enabled,
        variations: draft.variations,
      }),
    }),
  ] as const;
  await db.batch([statements[0], ...statements.slice(1)]);
  return { kind: "ok" };
}

export async function deleteFlag(
  db: DrizzleD1Database,
  options: {
    projectId: string;
    flagKey: string;
    actor: Actor;
    projectKey: string;
  },
): Promise<boolean> {
  const flag = await loadFlagRow(db, options.projectId, options.flagKey);
  if (!flag) {
    return false;
  }
  await db.batch([
    db.delete(flagEnvironments).where(eq(flagEnvironments.flagId, flag.id)),
    db.delete(variations).where(eq(variations.flagId, flag.id)),
    db.delete(flags).where(eq(flags.id, flag.id)),
    changeLogInsert(db, {
      actor: options.actor,
      action: "flag.delete",
      projectKey: options.projectKey,
      flagKey: options.flagKey,
      target: `${options.projectKey}/${options.flagKey}`,
      before: snapshot({
        key: flag.key,
        name: flag.name,
        kind: flag.kind,
      }),
    }),
  ]);
  return true;
}
