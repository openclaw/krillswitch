import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { type AdminRole, roleGrants } from "../db/schema";

/** Editors and admins may mutate flags; viewers are read-only. */
export function canEditFlags(role: AdminRole): boolean {
  return role === "editor" || role === "admin";
}

/**
 * Explicit grant wins; otherwise the bootstrap admin env var lets the first
 * real admin in before any grants exist (no row is written — the grant stays
 * env-derived until an explicit one is created); otherwise membership of the
 * configured GitHub org (cached on the user at sign-in) grants read-only
 * viewer — deliberately never editor.
 */
export async function resolveRole(
  db: DrizzleD1Database,
  user: { id: string; email: string; orgViewer?: boolean | null },
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
  if (user.orgViewer) {
    return "viewer";
  }
  return null;
}
