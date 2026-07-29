import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { environments, flagEnvironments, flags, projects } from "../db/schema";
import { type Actor, changeLogInsert } from "./changeLog";

export type ProjectDetail = {
  project: { id: string; key: string; name: string };
  environments: { id: string; key: string; name: string }[];
};

export type FlagListEntry = {
  id: string;
  key: string;
  name: string;
  kind: string;
  description: string | null;
  enabled: boolean;
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
): Promise<FlagListEntry[]> {
  const rows = await db
    .select({
      id: flags.id,
      key: flags.key,
      name: flags.name,
      kind: flags.kind,
      description: flags.description,
      enabled: flagEnvironments.enabled,
    })
    .from(flagEnvironments)
    .innerJoin(flags, eq(flagEnvironments.flagId, flags.id))
    .where(eq(flagEnvironments.environmentId, environmentId))
    .all();
  return rows.sort((a, b) => a.key.localeCompare(b.key));
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
