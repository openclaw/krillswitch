import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncOrgViewerMembership } from "../src/auth/orgMembership";
import { resolveRole } from "../src/auth/roles";
import { user } from "../src/db/authSchema";
import { roleGrants } from "../src/db/schema";

const db = drizzle(env.DB);
const ORG_ENV = { GITHUB_VIEWER_ORG: "openclaw" };

const TEST_USER_ID = "user_org_viewer_test";

function githubAccount(accessToken = "gh-token") {
  return { providerId: "github", userId: TEST_USER_ID, accessToken };
}

function membershipResponse(status: number, state?: string) {
  return vi.fn(
    async () =>
      new Response(state ? JSON.stringify({ state }) : "{}", { status }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

async function storedOrgViewer(): Promise<boolean | null> {
  const row = await db
    .select({ orgViewer: user.orgViewer })
    .from(user)
    .where(eq(user.id, TEST_USER_ID))
    .get();
  return row?.orgViewer ?? null;
}

beforeEach(async () => {
  await db.delete(roleGrants).where(eq(roleGrants.userId, TEST_USER_ID));
  await db.delete(user).where(eq(user.id, TEST_USER_ID));
  await db.insert(user).values({
    id: TEST_USER_ID,
    name: "Org Member",
    email: "org-member@example.com",
    emailVerified: true,
    orgViewer: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe("syncOrgViewerMembership", () => {
  it("caches active membership on the user row", async () => {
    const fetchMock = membershipResponse(200, "active");
    await syncOrgViewerMembership(db, ORG_ENV, githubAccount(), fetchMock);
    expect(await storedOrgViewer()).toBe(true);
    const requestedUrl = fetchMock.mock.calls[0]?.[0];
    expect(requestedUrl).toBe(
      "https://api.github.com/user/memberships/orgs/openclaw",
    );
  });

  it("clears membership when GitHub says the user is not a member", async () => {
    await db
      .update(user)
      .set({ orgViewer: true })
      .where(eq(user.id, TEST_USER_ID));
    await syncOrgViewerMembership(
      db,
      ORG_ENV,
      githubAccount(),
      membershipResponse(404),
    );
    expect(await storedOrgViewer()).toBe(false);
  });

  it("keeps the cached value when GitHub is unreachable", async () => {
    await db
      .update(user)
      .set({ orgViewer: true })
      .where(eq(user.id, TEST_USER_ID));
    const failingFetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await syncOrgViewerMembership(db, ORG_ENV, githubAccount(), failingFetch);
    expect(await storedOrgViewer()).toBe(true);
  });

  it("does nothing without a configured org or for non-GitHub accounts", async () => {
    const fetchMock = membershipResponse(200, "active");
    await syncOrgViewerMembership(db, {}, githubAccount(), fetchMock);
    await syncOrgViewerMembership(
      db,
      ORG_ENV,
      { providerId: "credential", userId: TEST_USER_ID, accessToken: "x" },
      fetchMock,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await storedOrgViewer()).toBe(false);
  });
});

describe("org-derived viewer role", () => {
  it("falls back to viewer for org members with no grant", async () => {
    const role = await resolveRole(
      db,
      { id: TEST_USER_ID, email: "org-member@example.com", orgViewer: true },
      undefined,
    );
    expect(role).toBe("viewer");
  });

  it("lets an explicit grant win over org membership", async () => {
    await db.insert(roleGrants).values({
      id: "grant_org_viewer_test",
      userId: TEST_USER_ID,
      role: "editor",
      grantedBy: "test",
      createdAt: new Date(),
    });
    const role = await resolveRole(
      db,
      { id: TEST_USER_ID, email: "org-member@example.com", orgViewer: true },
      undefined,
    );
    expect(role).toBe("editor");
  });

  it("gives non-members no access", async () => {
    const role = await resolveRole(
      db,
      { id: TEST_USER_ID, email: "org-member@example.com", orgViewer: false },
      undefined,
    );
    expect(role).toBeNull();
  });
});
