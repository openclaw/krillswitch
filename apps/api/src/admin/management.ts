import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { user } from "../db/authSchema";
import {
  type AdminRole,
  environments,
  evalKeys,
  flagEnvironments,
  flags,
  projects,
  roleGrants,
  variations,
} from "../db/schema";
import { type Actor, changeLogInsert } from "./changeLog";

export type UserWithRole = {
  id: string;
  name: string;
  email: string;
  role: AdminRole | null;
};

export async function listUsers(
  db: DrizzleD1Database,
): Promise<UserWithRole[]> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: roleGrants.role,
    })
    .from(user)
    .leftJoin(roleGrants, eq(roleGrants.userId, user.id))
    .all();
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export type SetRoleOutcome = "ok" | "not_found" | "last_admin";

export async function setUserRole(
  db: DrizzleD1Database,
  options: { userId: string; role: AdminRole | null; actor: Actor },
): Promise<SetRoleOutcome> {
  const target = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, options.userId))
    .get();
  if (!target) {
    return "not_found";
  }
  const existing = await db
    .select()
    .from(roleGrants)
    .where(eq(roleGrants.userId, options.userId))
    .get();

  // Lockout guard: the only admin grant cannot be demoted or revoked.
  if (existing?.role === "admin" && options.role !== "admin") {
    const adminGrants = await db
      .select({ id: roleGrants.id })
      .from(roleGrants)
      .where(eq(roleGrants.role, "admin"))
      .all();
    if (adminGrants.length <= 1) {
      return "last_admin";
    }
  }

  const logEntry = changeLogInsert(db, {
    actor: options.actor,
    action: "role.set",
    target: target.email,
    before: { role: existing?.role ?? null },
    after: { role: options.role },
  });

  if (options.role === null) {
    if (existing) {
      await db.batch([
        db.delete(roleGrants).where(eq(roleGrants.id, existing.id)),
        logEntry,
      ]);
    }
    return "ok";
  }
  if (existing) {
    await db.batch([
      db
        .update(roleGrants)
        .set({ role: options.role, grantedBy: options.actor.id })
        .where(eq(roleGrants.id, existing.id)),
      logEntry,
    ]);
    return "ok";
  }
  await db.batch([
    db.insert(roleGrants).values({
      id: `grant_${crypto.randomUUID()}`,
      userId: options.userId,
      role: options.role,
      grantedBy: options.actor.id,
      createdAt: new Date(),
    }),
    logEntry,
  ]);
  return "ok";
}

function generateEvalKey(projectKey: string, environmentKey: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `ks_${projectKey}_${environmentKey}_${suffix}`;
}

export async function createProject(
  db: DrizzleD1Database,
  options: { key: string; name: string; actor: Actor },
): Promise<"ok" | "duplicate_key"> {
  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.key, options.key))
    .get();
  if (existing) {
    return "duplicate_key";
  }
  await db.batch([
    db.insert(projects).values({
      id: `proj_${crypto.randomUUID()}`,
      key: options.key,
      name: options.name,
    }),
    changeLogInsert(db, {
      actor: options.actor,
      action: "project.create",
      projectKey: options.key,
      target: options.key,
      after: { key: options.key, name: options.name },
    }),
  ]);
  return "ok";
}

export async function createEnvironment(
  db: DrizzleD1Database,
  options: {
    projectId: string;
    projectKey: string;
    key: string;
    name: string;
    actor: Actor;
  },
): Promise<{ kind: "ok"; evalKey: string } | { kind: "duplicate_key" }> {
  const existing = await db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        eq(environments.projectId, options.projectId),
        eq(environments.key, options.key),
      ),
    )
    .get();
  if (existing) {
    return { kind: "duplicate_key" };
  }

  const environmentId = `env_${crypto.randomUUID()}`;
  const evalKey = generateEvalKey(options.projectKey, options.key);

  // Existing flags must exist in the new environment too — safely off,
  // serving their first variation when toggled on.
  const projectFlags = await db
    .select({ id: flags.id })
    .from(flags)
    .where(eq(flags.projectId, options.projectId))
    .all();
  const backfill = [];
  for (const flag of projectFlags) {
    const firstVariation = await db
      .select({ id: variations.id })
      .from(variations)
      .where(eq(variations.flagId, flag.id))
      .orderBy(variations.sortOrder)
      .get();
    if (!firstVariation) continue;
    backfill.push(
      db.insert(flagEnvironments).values({
        id: `fe_${crypto.randomUUID()}`,
        flagId: flag.id,
        environmentId,
        enabled: false,
        offVariationId: firstVariation.id,
        defaultVariationId: firstVariation.id,
        targets: [],
        rules: [],
        rollout: null,
      }),
    );
  }

  await db.batch([
    db.insert(environments).values({
      id: environmentId,
      projectId: options.projectId,
      key: options.key,
      name: options.name,
    }),
    db.insert(evalKeys).values({
      id: `ek_${crypto.randomUUID()}`,
      environmentId,
      key: evalKey,
    }),
    ...backfill,
    changeLogInsert(db, {
      actor: options.actor,
      action: "environment.create",
      projectKey: options.projectKey,
      target: `${options.projectKey}/${options.key}`,
      after: { key: options.key, name: options.name },
    }),
  ]);
  return { kind: "ok", evalKey };
}

export type EnvironmentKey = {
  environmentId: string;
  environmentKey: string;
  environmentName: string;
  evalKey: string;
};

export async function listKeys(
  db: DrizzleD1Database,
  projectId: string,
): Promise<EnvironmentKey[]> {
  const rows = await db
    .select({
      environmentId: environments.id,
      environmentKey: environments.key,
      environmentName: environments.name,
      evalKey: evalKeys.key,
    })
    .from(evalKeys)
    .innerJoin(environments, eq(evalKeys.environmentId, environments.id))
    .where(eq(environments.projectId, projectId))
    .all();
  return rows.sort((a, b) => a.environmentKey.localeCompare(b.environmentKey));
}

/**
 * Immediate invalidation: the old key stops resolving as soon as the row
 * updates. A grace-overlap policy is an open PRD question, deliberately
 * not implemented yet.
 */
export async function rotateKey(
  db: DrizzleD1Database,
  options: {
    projectId: string;
    projectKey: string;
    environmentKey: string;
    actor: Actor;
  },
): Promise<{ kind: "ok"; evalKey: string } | { kind: "not_found" }> {
  const environment = await db
    .select({ id: environments.id, oldKey: evalKeys.key })
    .from(environments)
    .innerJoin(evalKeys, eq(evalKeys.environmentId, environments.id))
    .where(
      and(
        eq(environments.projectId, options.projectId),
        eq(environments.key, options.environmentKey),
      ),
    )
    .get();
  if (!environment) {
    return { kind: "not_found" };
  }
  const evalKey = generateEvalKey(options.projectKey, options.environmentKey);
  await db.batch([
    db
      .update(evalKeys)
      .set({ key: evalKey })
      .where(eq(evalKeys.environmentId, environment.id)),
    changeLogInsert(db, {
      actor: options.actor,
      action: "key.rotate",
      projectKey: options.projectKey,
      target: `${options.projectKey}/${options.environmentKey}`,
      before: { evalKey: environment.oldKey },
      after: { evalKey },
    }),
  ]);
  return { kind: "ok", evalKey };
}
