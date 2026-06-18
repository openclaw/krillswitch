import type { JsonValue } from "@openclaw/krillswitch-core";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { type ChangeAction, changeLog } from "../db/schema";

export type Actor = { id: string; name: string };

export type ChangeEntry = {
  actor: Actor;
  action: ChangeAction;
  projectKey?: string;
  flagKey?: string;
  target: string;
  before?: JsonValue;
  after?: JsonValue;
};

/**
 * Returns the insert statement so callers put it in the SAME db.batch as the
 * mutation it describes — the log can't drift from reality.
 */
export function changeLogInsert(db: DrizzleD1Database, entry: ChangeEntry) {
  return db.insert(changeLog).values({
    id: `chg_${crypto.randomUUID()}`,
    actorUserId: entry.actor.id,
    actorName: entry.actor.name,
    action: entry.action,
    projectKey: entry.projectKey ?? null,
    flagKey: entry.flagKey ?? null,
    target: entry.target,
    before: entry.before ?? null,
    after: entry.after ?? null,
    createdAt: new Date(),
  });
}

export type ChangeLogFilter = {
  flagKey?: string;
  projectKey?: string;
  actorUserId?: string;
};

function filterCondition(filter: ChangeLogFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.flagKey) conditions.push(eq(changeLog.flagKey, filter.flagKey));
  if (filter.projectKey) {
    conditions.push(eq(changeLog.projectKey, filter.projectKey));
  }
  if (filter.actorUserId) {
    conditions.push(eq(changeLog.actorUserId, filter.actorUserId));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listChangeLog(
  db: DrizzleD1Database,
  filter: ChangeLogFilter & { limit: number; offset: number },
) {
  let query = db.select().from(changeLog).$dynamic();
  const condition = filterCondition(filter);
  if (condition) {
    query = query.where(condition);
  }
  return query
    .orderBy(desc(changeLog.createdAt))
    .limit(filter.limit)
    .offset(filter.offset)
    .all();
}

/** A single audit entry by id, or undefined. Read-only, like the list. */
export async function getChangeLogEntry(db: DrizzleD1Database, id: string) {
  return db.select().from(changeLog).where(eq(changeLog.id, id)).get();
}

export async function countChangeLog(
  db: DrizzleD1Database,
  filter: ChangeLogFilter,
): Promise<number> {
  let query = db.select({ n: count() }).from(changeLog).$dynamic();
  const condition = filterCondition(filter);
  if (condition) {
    query = query.where(condition);
  }
  const row = await query.get();
  return row?.n ?? 0;
}

/** Serialization boundary: anything JSON-shaped becomes a storable value. */
export function snapshot(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null));
}

/** Shallow diff: keep only top-level fields whose JSON changed. */
export function changedFields(
  before: Record<string, JsonValue>,
  after: Record<string, JsonValue>,
): { before: Record<string, JsonValue>; after: Record<string, JsonValue> } {
  const beforeChanged: Record<string, JsonValue> = {};
  const afterChanged: Record<string, JsonValue> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const beforeValue = before[key] ?? null;
    const afterValue = after[key] ?? null;
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      beforeChanged[key] = beforeValue;
      afterChanged[key] = afterValue;
    }
  }
  return { before: beforeChanged, after: afterChanged };
}
