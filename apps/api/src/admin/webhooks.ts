import { eq, gt, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { changeLog, webhooks } from "../db/schema";
import { type Actor, changeLogInsert } from "./changeLog";

const DRAIN_BATCH = 10;

export class WebhookUrlError extends Error {
  constructor() {
    super("invalid webhook url");
    this.name = "WebhookUrlError";
  }
}

const blockedHostnames = new Set(["localhost", "metadata.google.internal"]);

/** Public HTTPS only. Blocks private, link-local, and metadata hosts. */
export function assertPublicHttpsWebhookUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new WebhookUrlError();
  }
  if (parsed.protocol !== "https:") {
    throw new WebhookUrlError();
  }
  if (parsed.username || parsed.password) {
    throw new WebhookUrlError();
  }
  const host = unwrapHostname(parsed.hostname);
  if (blockedHostnames.has(host) || host.endsWith(".localhost")) {
    throw new WebhookUrlError();
  }
  if (isPrivateOrLinkLocalHost(host)) {
    throw new WebhookUrlError();
  }
  return parsed;
}

/** WHATWG URL.hostname keeps brackets around IPv6 literals. */
function unwrapHostname(host: string): string {
  const lower = host.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) {
    return lower.slice(1, -1);
  }
  return lower;
}

function isPrivateOrLinkLocalHost(host: string): boolean {
  if (host === "::1" || host === "0.0.0.0") {
    return true;
  }
  if (host.includes(":")) {
    const groups = parseIpv6Groups(host);
    return groups !== null && isNonPublicIpv6(groups);
  }
  const parts = parseIpv4Octets(host);
  return parts !== null && isPrivateIpv4(parts);
}

function parseIpv4Octets(
  host: string,
): [number, number, number, number] | null {
  const parts = host.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return [parts[0], parts[1], parts[2], parts[3]];
}

function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  return a === 100 && b >= 64 && b <= 127;
}

function parseHexGroup(group: string): number | null {
  if (!group || group.length > 4 || !/^[0-9a-f]+$/i.test(group)) {
    return null;
  }
  return Number.parseInt(group, 16);
}

function parseIpv6Groups(addr: string): number[] | null {
  const bare = addr.split("%")[0] ?? "";
  let ipv4Tail: [number, number] | null = null;
  let hexPart = bare;
  const lastColon = bare.lastIndexOf(":");
  const after = lastColon >= 0 ? bare.slice(lastColon + 1) : "";
  if (after.includes(".")) {
    const v4 = parseIpv4Octets(after);
    if (!v4) {
      return null;
    }
    ipv4Tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    hexPart = bare.slice(0, lastColon);
  }
  const sides = hexPart.split("::");
  if (sides.length > 2) {
    return null;
  }
  const left = sides[0] === "" ? [] : sides[0].split(":");
  const right =
    sides.length === 2 ? (sides[1] === "" ? [] : sides[1].split(":")) : [];
  const expected = 8 - (ipv4Tail ? 2 : 0);
  const have = left.length + right.length;
  const groups: number[] = [];
  const pushGroups = (raw: string[]): boolean => {
    for (const group of raw) {
      const value = parseHexGroup(group);
      if (value === null) {
        return false;
      }
      groups.push(value);
    }
    return true;
  };
  if (sides.length === 2) {
    if (have > expected) {
      return null;
    }
    if (!pushGroups(left)) {
      return null;
    }
    for (let i = 0; i < expected - have; i += 1) {
      groups.push(0);
    }
    if (!pushGroups(right)) {
      return null;
    }
  } else {
    if (have !== expected) {
      return null;
    }
    if (!pushGroups(left)) {
      return null;
    }
  }
  if (ipv4Tail) {
    groups.push(ipv4Tail[0], ipv4Tail[1]);
  }
  return groups.length === 8 ? groups : null;
}

function isNonPublicIpv6(groups: number[]): boolean {
  const zero = groups.every((group) => group === 0);
  if (zero || (zeroExceptLast(groups) && groups[7] === 1)) {
    return true;
  }
  if ((groups[0] & 0xffc0) === 0xfe80) {
    return true;
  }
  if ((groups[0] & 0xfe00) === 0xfc00) {
    return true;
  }
  const mapped =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff;
  if (mapped) {
    return isPrivateIpv4([
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ]);
  }
  return false;
}

function zeroExceptLast(groups: number[]): boolean {
  return groups.slice(0, 7).every((group) => group === 0);
}

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
  assertPublicHttpsWebhookUrl(options.url);
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
 *  Delivery is notify-only: the cursor advances even when the POST fails,
 *  and last_status shows the most recent outcome. */
export async function drainWebhooks(
  db: DrizzleD1Database,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const hooks = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.enabled, true))
    .all();
  for (const hook of hooks) {
    try {
      await drainOneWebhook(db, fetcher, hook);
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
    try {
      assertPublicHttpsWebhookUrl(hook.url);
    } catch {
      const lastRowid = entries[entries.length - 1]?.rowid ?? hook.cursor;
      await db
        .update(webhooks)
        .set({
          cursor: lastRowid,
          lastStatus: "blocked",
          lastSentAt: new Date(),
        })
        .where(eq(webhooks.id, hook.id));
      return;
    }
    let status = "ok";
    for (const { rowid: _rowid, ...entry } of entries) {
      try {
        const response = await fetcher(hook.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "change", entry }),
        });
        if (!response.ok) {
          status = `http ${response.status}`;
        }
      } catch {
        status = "unreachable";
      }
    }
    const lastRowid = entries[entries.length - 1]?.rowid ?? hook.cursor;
    await db
      .update(webhooks)
      .set({ cursor: lastRowid, lastStatus: status, lastSentAt: new Date() })
      .where(eq(webhooks.id, hook.id));
  }
}
