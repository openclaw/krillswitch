import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { user } from "../db/authSchema";

export type OrgMembershipEnv = { GITHUB_VIEWER_ORG?: string };

export type OAuthAccount = {
  providerId: string;
  userId: string;
  accessToken?: string | null;
};

/** Bound so a stalled api.github.com cannot pin the OAuth sign-in hook. */
export const ORG_MEMBERSHIP_FETCH_TIMEOUT_MS = 5_000;

/**
 * Members of the configured GitHub org get read-only viewer access when they
 * hold no explicit grant (grant always wins). Membership is checked once per
 * sign-in with the user's own token — never per request — and cached on the
 * user row, which role resolution reads.
 */
export async function syncOrgViewerMembership(
  db: DrizzleD1Database,
  env: OrgMembershipEnv,
  account: OAuthAccount,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = ORG_MEMBERSHIP_FETCH_TIMEOUT_MS,
): Promise<void> {
  const org = env.GITHUB_VIEWER_ORG?.trim();
  if (account.providerId !== "github") {
    return;
  }
  if (!org) {
    await db
      .update(user)
      .set({ orgViewer: false })
      .where(eq(user.id, account.userId));
    return;
  }
  if (!account.accessToken) return;

  let isMember = false;
  try {
    const response = await fetchImpl(
      `https://api.github.com/user/memberships/orgs/${encodeURIComponent(org)}`,
      {
        headers: {
          authorization: `Bearer ${account.accessToken}`,
          accept: "application/vnd.github+json",
          "user-agent": "krillswitch-admin",
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (response.ok) {
      const body = (await response.json()) as { state?: string };
      isMember = body.state === "active";
    }
    // Non-2xx (404 = not a member, 403 = scope withheld) → not a member.
  } catch {
    // GitHub unreachable: keep whatever was cached from the last sign-in.
    return;
  }

  await db
    .update(user)
    .set({ orgViewer: isMember })
    .where(eq(user.id, account.userId));
}
