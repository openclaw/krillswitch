import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import { user } from "../db/authSchema";

export type CloudflareAccessEnv = {
  CLOUDFLARE_ACCESS_AUD?: string;
  CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
};

export type CloudflareAccessUser = {
  id: string;
  name: string;
  email: string;
  orgViewer: true;
};

type VerifyJwt = (
  token: string,
  env: Required<CloudflareAccessEnv>,
) => Promise<JWTPayload>;

const jwksByTeamDomain = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

function configuredAccessEnv(
  env: CloudflareAccessEnv,
): Required<CloudflareAccessEnv> | null {
  const aud = env.CLOUDFLARE_ACCESS_AUD?.trim();
  const rawTeamDomain = env.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
  if (!aud || !rawTeamDomain) return null;
  const teamDomain = rawTeamDomain.startsWith("https://")
    ? rawTeamDomain
    : `https://${rawTeamDomain}`;
  return {
    CLOUDFLARE_ACCESS_AUD: aud,
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: teamDomain.replace(/\/+$/, ""),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function emailFromPayload(payload: JWTPayload): string | null {
  return typeof payload.email === "string" && payload.email.includes("@")
    ? payload.email.trim().toLowerCase()
    : null;
}

function nameFromPayload(payload: JWTPayload, email: string): string {
  if (typeof payload.name === "string" && payload.name.trim()) {
    return payload.name.trim();
  }
  return email.split("@")[0] ?? email;
}

async function verifyAccessJwt(
  token: string,
  env: Required<CloudflareAccessEnv>,
): Promise<JWTPayload> {
  const teamDomain = env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
  let jwks = jwksByTeamDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeamDomain.set(teamDomain, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, {
    issuer: teamDomain,
    audience: env.CLOUDFLARE_ACCESS_AUD,
  });
  return payload;
}

export async function cloudflareAccessUser(
  db: DrizzleD1Database,
  env: CloudflareAccessEnv,
  headers: Headers,
  verifyJwt: VerifyJwt = verifyAccessJwt,
): Promise<CloudflareAccessUser | null> {
  const accessEnv = configuredAccessEnv(env);
  if (!accessEnv) return null;

  const token = headers.get("cf-access-jwt-assertion")?.trim();
  if (!token) return null;

  const payload = await verifyJwt(token, accessEnv);
  const email = emailFromPayload(payload);
  if (!email) return null;

  const now = new Date();
  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .get();
  const id = existing?.id ?? `cfacc_${await sha256Hex(email)}`;
  const name = nameFromPayload(payload, email);

  if (existing) {
    await db
      .update(user)
      .set({
        name,
        emailVerified: true,
        orgViewer: true,
        updatedAt: now,
      })
      .where(eq(user.id, existing.id));
  } else {
    await db.insert(user).values({
      id,
      name,
      email,
      emailVerified: true,
      image: null,
      orgViewer: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { id, name, email, orgViewer: true };
}
