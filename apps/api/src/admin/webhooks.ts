import { eq, gt, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { changeLog, webhooks } from "../db/schema";
import { type Actor, changeLogInsert } from "./changeLog";

const DRAIN_BATCH = 10;
/** Bound each subscriber POST so a stalled URL cannot pin waitUntil. */
export const WEBHOOK_DRAIN_FETCH_TIMEOUT_MS = 2_000;

export type WebhookRow = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastStatus: string | null;
  lastSentAt: Date | null;
  createdAt: Date;
};

export async function listWebhooks(
  db: DrizzleD1Database,
): Promise<WebhookRow[]> {
  const rows = await db
    .select({
      id: webhooks.id,
      name: webhooks.name,
      url: webhooks.url,
      enabled: webhooks.enabled,
      lastStatus: webhooks.lastStatus,
      lastSentAt: webhooks.lastSentAt,
      createdAt: webhooks.createdAt,
    })
    .from(webhooks)
    .all();
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function createWebhook(
  db: DrizzleD1Database,
  options: { name: string; url: string; actor: Actor },
): Promise<string> {
  const id = crypto.randomUUID();
  // New webhooks start at the current change-log tail so they only receive
  // changes made after they were added.
  const tail = await db
    .select({ tail: sql<number>`coalesce(max(rowid), 0)` })
    .from(changeLog)
    .get();
  await db.batch([
    db.insert(webhooks).values({
      id,
      name: options.name,
      url: options.url,
      cursor: tail?.tail ?? 0,
      createdAt: new Date(),
    }),
    changeLogInsert(db, {
      actor: options.actor,
      action: "webhook.create",
      target: options.url,
      after: { name: options.name, url: options.url },
    }),
  ]);
  return id;
}

export async function setWebhookEnabled(
  db: DrizzleD1Database,
  options: { id: string; enabled: boolean; actor: Actor },
): Promise<boolean> {
  const row = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, options.id))
    .get();
  if (!row) {
    return false;
  }
  await db.batch([
    db
      .update(webhooks)
      .set({ enabled: options.enabled })
      .where(eq(webhooks.id, options.id)),
    changeLogInsert(db, {
      actor: options.actor,
      action: "webhook.update",
      target: row.url,
      before: { enabled: row.enabled },
      after: { enabled: options.enabled },
    }),
  ]);
  return true;
}

export async function deleteWebhook(
  db: DrizzleD1Database,
  options: { id: string; actor: Actor },
): Promise<boolean> {
  const row = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, options.id))
    .get();
  if (!row) {
    return false;
  }
  await db.batch([
    db.delete(webhooks).where(eq(webhooks.id, options.id)),
    changeLogInsert(db, {
      actor: options.actor,
      action: "webhook.delete",
      target: row.url,
      before: { name: row.name, url: row.url },
    }),
  ]);
  return true;
}

/** POST change-log entries newer than each enabled webhook's cursor.
 *  Runs off the request path (waitUntil) after every admin mutation.
 *  Delivery is notify-only: HTTP, network, and timeout failures all
 *  advance the cursor so a dead or slow subscriber cannot stall the
 *  queue or duplicate a post that already completed after cutoff. */
export async function drainWebhooks(
  db: DrizzleD1Database,
  fetcher: typeof fetch = fetch,
  timeoutMs = WEBHOOK_DRAIN_FETCH_TIMEOUT_MS,
): Promise<void> {
  const hooks = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.enabled, true))
    .all();
  for (const hook of hooks) {
    try {
      await drainOneWebhook(db, fetcher, hook, timeoutMs);
    } catch {
      // Notification must never surface as a worker error; the cursor simply
      // stays put and the next mutation retries the drain.
    }
  }
}

async function drainOneWebhook(
  db: DrizzleD1Database,
  fetcher: typeof fetch,
  hook: typeof webhooks.$inferSelect,
  timeoutMs: number,
): Promise<void> {
  {
    const entries = await db
      .select({
        rowid: sql<number>`rowid`,
        id: changeLog.id,
        actorName: changeLog.actorName,
        action: changeLog.action,
        projectKey: changeLog.projectKey,
        flagKey: changeLog.flagKey,
        target: changeLog.target,
        before: changeLog.before,
        after: changeLog.after,
        comment: changeLog.comment,
        createdAt: changeLog.createdAt,
      })
      .from(changeLog)
      .where(gt(sql`rowid`, hook.cursor))
      .orderBy(sql`rowid`)
      .limit(DRAIN_BATCH)
      .all();
    if (entries.length === 0) {
      return;
    }
    let status = "ok";
    let cursor = hook.cursor;
    for (const { rowid, ...entry } of entries) {
      try {
        const response = await fetcher(hook.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "change", entry }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          status = `http ${response.status}`;
        }
        cursor = rowid;
      } catch (error) {
        if (isFetchTimeout(error)) {
          status = "timeout";
          cursor = rowid;
          break;
        }
        status = "unreachable";
        cursor = rowid;
      }
    }
    await db
      .update(webhooks)
      .set({ cursor, lastStatus: status, lastSentAt: new Date() })
      .where(eq(webhooks.id, hook.id));
  }
}

function isFetchTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}
