import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { type AdminRole, roleGrants } from "../db/schema";

/**
 * Explicit grant wins; otherwise the bootstrap admin env var lets the first
 * real admin in before any grants exist (no row is written — the grant stays
 * env-derived until an explicit one is created).
 */
export async function resolveRole(
  db: DrizzleD1Database,
  user: { id: string; email: string },
  bootstrapAdminEmail: string | undefined,
): Promise<AdminRole | null> {
  const grant = await db
    .select({ role: roleGrants.role })
    .from(roleGrants)
    .where(eq(roleGrants.userId, user.id))
    .get();
  if (grant) return grant.role;
  if (bootstrapAdminEmail && user.email === bootstrapAdminEmail) {
    return "admin";
  }
  return null;
}
