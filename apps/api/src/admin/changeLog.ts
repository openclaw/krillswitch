import type { JsonValue } from "@openclaw/krillswitch-core";
import { desc, eq } from "drizzle-orm";
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

const PAGE_SIZE = 200;

export async function listChangeLog(
  db: DrizzleD1Database,
  filter: { flagKey?: string; projectKey?: string },
) {
  let query = db.select().from(changeLog).$dynamic();
  if (filter.flagKey) {
    query = query.where(eq(changeLog.flagKey, filter.flagKey));
  } else if (filter.projectKey) {
    query = query.where(eq(changeLog.projectKey, filter.projectKey));
  }
  return query.orderBy(desc(changeLog.createdAt)).limit(PAGE_SIZE).all();
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
