import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { accessTokens, type TokenRole } from "../db/schema";
import { type Actor, changeLogInsert } from "./changeLog";

export const TOKEN_PREFIX = "ksat_";

export type TokenActor = { id: string; name: string; role: TokenRole };

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** SHA-256 hex. Right for a 256-bit random token — not a low-entropy password. */
async function hashToken(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(plaintext),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function mintToken(
  db: DrizzleD1Database,
  options: { name: string; role: TokenRole; actor: Actor },
): Promise<{ id: string; token: string }> {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const token = `${TOKEN_PREFIX}${toBase64Url(random)}`;
  const id = `tok_${crypto.randomUUID()}`;
  await db.batch([
    db.insert(accessTokens).values({
      id,
      name: options.name,
      role: options.role,
      tokenHash: await hashToken(token),
      createdBy: options.actor.id,
      createdAt: new Date(),
    }),
    changeLogInsert(db, {
      actor: options.actor,
      action: "token.mint",
      target: options.name,
      after: { id, role: options.role },
    }),
  ]);
  return { id, token };
}

export type TokenListEntry = {
  id: string;
  name: string;
  role: TokenRole;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

/** Optional `createdBy` scopes the list to one minter (a member's profile). */
export type TokenFilter = { createdBy?: string };

export async function listTokens(
  db: DrizzleD1Database,
  page: { limit: number; offset: number },
  filter: TokenFilter = {},
): Promise<TokenListEntry[]> {
  let query = db
    .select({
      id: accessTokens.id,
      name: accessTokens.name,
      role: accessTokens.role,
      createdAt: accessTokens.createdAt,
      lastUsedAt: accessTokens.lastUsedAt,
      revokedAt: accessTokens.revokedAt,
    })
    .from(accessTokens)
    .$dynamic();
  if (filter.createdBy) {
    query = query.where(eq(accessTokens.createdBy, filter.createdBy));
  }
  const rows = await query
    .orderBy(desc(accessTokens.createdAt))
    .limit(page.limit)
    .offset(page.offset)
    .all();
  // Never expose the hash; timestamps serialize as epoch ms over JSON.
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.getTime(),
    lastUsedAt: row.lastUsedAt?.getTime() ?? null,
    revokedAt: row.revokedAt?.getTime() ?? null,
  }));
}

export async function countTokens(
  db: DrizzleD1Database,
  filter: TokenFilter = {},
): Promise<number> {
  let query = db.select({ n: count() }).from(accessTokens).$dynamic();
  if (filter.createdBy) {
    query = query.where(eq(accessTokens.createdBy, filter.createdBy));
  }
  const row = await query.get();
  return row?.n ?? 0;
}

export async function revokeToken(
  db: DrizzleD1Database,
  id: string,
  actor: Actor,
): Promise<boolean> {
  const existing = await db
    .select({
      id: accessTokens.id,
      name: accessTokens.name,
      role: accessTokens.role,
      revokedAt: accessTokens.revokedAt,
    })
    .from(accessTokens)
    .where(eq(accessTokens.id, id))
    .get();
  if (!existing) {
    return false;
  }
  if (existing.revokedAt) {
    return true;
  }
  await db.batch([
    db
      .update(accessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(accessTokens.id, id)),
    changeLogInsert(db, {
      actor,
      action: "token.revoke",
      target: existing.name,
      before: { id, role: existing.role, revoked: false },
      after: { id, role: existing.role, revoked: true },
    }),
  ]);
  return true;
}

/**
 * Resolve a bearer value to a non-revoked token actor, or null. Only strings
 * carrying the access-token prefix are considered, so eval keys (`ks_`) and
 * session cookies never reach here. Touches last-used best-effort.
 */
export async function authenticateToken(
  db: DrizzleD1Database,
  bearer: string,
): Promise<TokenActor | null> {
  if (!bearer.startsWith(TOKEN_PREFIX)) {
    return null;
  }
  const tokenHash = await hashToken(bearer);
  const row = await db
    .select({
      id: accessTokens.id,
      name: accessTokens.name,
      role: accessTokens.role,
    })
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.tokenHash, tokenHash),
        isNull(accessTokens.revokedAt),
      ),
    )
    .get();
  if (!row) {
    return null;
  }
  await db
    .update(accessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(accessTokens.id, row.id));
  return { id: row.id, name: row.name, role: row.role };
}
