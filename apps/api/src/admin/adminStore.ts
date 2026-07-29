import { and, eq, inArray, max } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  changeLog,
  environments,
  flagEnvironments,
  flags,
  projects,
  variations,
} from "../db/schema";
import { type Actor, changeLogInsert } from "./changeLog";

export type ProjectDetail = {
  project: { id: string; key: string; name: string };
  environments: {
    id: string;
    key: string;
    name: string;
    lastEvalAt: Date | null;
    evalCount: number;
  }[];
};

export type FlagListEntry = {
  id: string;
  key: string;
  name: string;
  kind: string;
  description: string | null;
  enabled: boolean;
};

/** List rows carry extra operational context the toggle response does not:
 *  archived state, what serves while off, and when the flag last changed
 *  (change-log time, environment-agnostic). The client merges toggle
 *  responses into rows, so these stay stable across a PATCH. */
export type FlagListRow = FlagListEntry & {
  archived: boolean;
  offVariation: string | null;
  lastChangedAt: Date | null;
};

export async function loadProjectDetail(
  db: DrizzleD1Database,
  projectKey: string,
): Promise<ProjectDetail | null> {
  const project = await db
    .select()
    .from(projects)
    .where(eq(projects.key, projectKey))
    .get();
  if (!project) {
    return null;
  }
  const environmentRows = await db
    .select({
      id: environments.id,
      key: environments.key,
      name: environments.name,
      lastEvalAt: environments.lastEvalAt,
      evalCount: environments.evalCount,
    })
    .from(environments)
    .where(eq(environments.projectId, project.id))
    .all();
  return { project, environments: environmentRows };
}

export async function resolveProjectId(
  db: DrizzleD1Database,
  projectKey: string,
): Promise<string | null> {
  const row = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.key, projectKey))
    .get();
  return row?.id ?? null;
}

export async function resolveEnvironment(
  db: DrizzleD1Database,
  projectKey: string,
  environmentKey: string,
): Promise<{ projectId: string; environmentId: string } | null> {
  const row = await db
    .select({ projectId: projects.id, environmentId: environments.id })
    .from(environments)
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .where(
      and(eq(projects.key, projectKey), eq(environments.key, environmentKey)),
    )
    .get();
  return row ?? null;
}

export async function loadFlagList(
  db: DrizzleD1Database,
  environmentId: string,
  projectKey: string,
): Promise<FlagListRow[]> {
  const rows = await db
    .select({
      id: flags.id,
      key: flags.key,
      name: flags.name,
      kind: flags.kind,
      description: flags.description,
      enabled: flagEnvironments.enabled,
      archived: flags.archived,
      offVariationId: flagEnvironments.offVariationId,
    })
    .from(flagEnvironments)
    .innerJoin(flags, eq(flagEnvironments.flagId, flags.id))
    .where(eq(flagEnvironments.environmentId, environmentId))
    .all();

  const offVariationIds = rows.map((row) => row.offVariationId);
  const variationRows = offVariationIds.length
    ? await db
        .select({
          id: variations.id,
          name: variations.name,
          value: variations.value,
        })
        .from(variations)
        .where(inArray(variations.id, offVariationIds))
        .all()
    : [];
  const offNames = new Map(
    variationRows.map((row) => [row.id, row.name ?? JSON.stringify(row.value)]),
  );

  const lastChanges = await db
    .select({
      flagKey: changeLog.flagKey,
      lastChangedAt: max(changeLog.createdAt),
    })
    .from(changeLog)
    .where(eq(changeLog.projectKey, projectKey))
    .groupBy(changeLog.flagKey)
    .all();
  const lastChangedByKey = new Map(
    lastChanges
      .filter((row) => row.flagKey !== null && row.lastChangedAt !== null)
      .map((row) => [row.flagKey, row.lastChangedAt as Date]),
  );

  return rows
    .map(({ offVariationId, ...row }) => ({
      ...row,
      offVariation: offNames.get(offVariationId) ?? null,
      lastChangedAt: lastChangedByKey.get(row.key) ?? null,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// Project-level flag keys (env-independent) for filter UIs like the change
// log combobox. Reads the flags table directly so flags without a row in any
// particular environment still appear.
export async function loadProjectFlagKeys(
  db: DrizzleD1Database,
  projectId: string,
): Promise<{ key: string; name: string }[]> {
  const rows = await db
    .select({ key: flags.key, name: flags.name })
    .from(flags)
    .where(eq(flags.projectId, projectId))
    .all();
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

export async function setFlagEnabled(
  db: DrizzleD1Database,
  options: {
    environmentId: string;
    flagKey: string;
    enabled: boolean;
    actor: Actor;
    projectKey: string;
    environmentKey: string;
    comment?: string;
  },
): Promise<FlagListEntry | null> {
  const row = await db
    .select({
      flagEnvironmentId: flagEnvironments.id,
      enabled: flagEnvironments.enabled,
      id: flags.id,
      key: flags.key,
      name: flags.name,
      kind: flags.kind,
      description: flags.description,
    })
    .from(flagEnvironments)
    .innerJoin(flags, eq(flagEnvironments.flagId, flags.id))
    .where(
      and(
        eq(flagEnvironments.environmentId, options.environmentId),
        eq(flags.key, options.flagKey),
      ),
    )
    .get();
  if (!row) {
    return null;
  }
  await db.batch([
    db
      .update(flagEnvironments)
      .set({ enabled: options.enabled })
      .where(eq(flagEnvironments.id, row.flagEnvironmentId)),
    changeLogInsert(db, {
      actor: options.actor,
      action: "flag.toggle",
      projectKey: options.projectKey,
      flagKey: options.flagKey,
      target: `${options.projectKey}/${options.environmentKey}/${options.flagKey}`,
      before: { enabled: row.enabled },
      after: { enabled: options.enabled },
      comment: options.comment,
    }),
  ]);
  const { flagEnvironmentId: _omitted, enabled: _was, ...flag } = row;
  return { ...flag, enabled: options.enabled };
}
