/** Helpers shared by the native /v1/eval route and the OFREP endpoints —
 *  both live on the public evaluation trust boundary and share auth,
 *  conditional-request, and stats semantics. */

/** Weak ETag over the serialized response so idle polls can 304. */
export function evalBodyEtag(serializedBody: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < serializedBody.length; i++) {
    hash ^= serializedBody.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `W/"${(hash >>> 0).toString(16)}"`;
}

export function bearerToken(
  authorization: string | undefined,
): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function matchesEtag(header: string | undefined, etag: string): boolean {
  return (
    header
      ?.split(",")
      .map((value) => value.trim())
      .some((value) => value === "*" || value === etag) ?? false
  );
}

export async function recordEvalStats(
  db: D1Database,
  environmentId: string,
): Promise<void> {
  try {
    const day = Math.floor(Date.now() / 86_400_000);
    await db.batch([
      db
        .prepare(
          "UPDATE environments SET eval_count = eval_count + 1, last_eval_at = ? WHERE id = ?",
        )
        .bind(Date.now(), environmentId),
      db
        .prepare(
          "INSERT INTO eval_stats_daily (environment_id, day, count) VALUES (?, ?, 1) ON CONFLICT(environment_id, day) DO UPDATE SET count = count + 1",
        )
        .bind(environmentId, day),
    ]);
  } catch {
    // Stats must never fail an eval; the next request tries again.
  }
}
