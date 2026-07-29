import type { AttributeValue } from "@openclaw/krillswitch-core";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import { segments } from "../db/schema";
import { type Actor, changeLogInsert } from "./changeLog";

export type SegmentDraft = {
  name: string;
  description: string | null;
  contextKeys: string[];
  rules: { attribute: string; values: AttributeValue[] }[];
};

const attributeValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const segmentBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  contextKeys: z.array(z.string().trim().min(1)).max(500),
  rules: z
    .array(
      z.object({
        attribute: z.string().trim().min(1),
        values: z.array(attributeValueSchema).min(1),
      }),
    )
    .max(50),
});

export const segmentCreateSchema = segmentBodySchema.extend({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/,
      "keys are lowercase alphanumerics plus . _ -",
    ),
});

export type SegmentRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  contextKeys: string[];
  rules: { attribute: string; values: AttributeValue[] }[];
  createdAt: Date;
};

export async function listSegments(
  db: DrizzleD1Database,
  projectId: string,
): Promise<SegmentRow[]> {
  const rows = await db
    .select({
      id: segments.id,
      key: segments.key,
      name: segments.name,
      description: segments.description,
      contextKeys: segments.contextKeys,
      rules: segments.rules,
      createdAt: segments.createdAt,
    })
    .from(segments)
    .where(eq(segments.projectId, projectId))
    .all();
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

export async function createSegment(
  db: DrizzleD1Database,
  options: {
    projectId: string;
    projectKey: string;
    key: string;
    draft: SegmentDraft;
    actor: Actor;
  },
): Promise<"created" | "conflict"> {
  const existing = await db
    .select({ id: segments.id })
    .from(segments)
    .where(
      and(
        eq(segments.projectId, options.projectId),
        eq(segments.key, options.key),
      ),
    )
    .get();
  if (existing) {
    return "conflict";
  }
  await db.batch([
    db.insert(segments).values({
      id: crypto.randomUUID(),
      projectId: options.projectId,
      key: options.key,
      name: options.draft.name,
      description: options.draft.description,
      contextKeys: options.draft.contextKeys,
      rules: options.draft.rules,
      createdAt: new Date(),
    }),
    changeLogInsert(db, {
      actor: options.actor,
      action: "segment.create",
      projectKey: options.projectKey,
      target: `${options.projectKey}/segments/${options.key}`,
      after: {
        name: options.draft.name,
        contextKeys: options.draft.contextKeys.length,
        rules: options.draft.rules.length,
      },
    }),
  ]);
  return "created";
}

export async function updateSegment(
  db: DrizzleD1Database,
  options: {
    projectId: string;
    projectKey: string;
    key: string;
    draft: SegmentDraft;
    actor: Actor;
  },
): Promise<boolean> {
  const existing = await db
    .select()
    .from(segments)
    .where(
      and(
        eq(segments.projectId, options.projectId),
        eq(segments.key, options.key),
      ),
    )
    .get();
  if (!existing) {
    return false;
  }
  await db.batch([
    db
      .update(segments)
      .set({
        name: options.draft.name,
        description: options.draft.description,
        contextKeys: options.draft.contextKeys,
        rules: options.draft.rules,
      })
      .where(eq(segments.id, existing.id)),
    changeLogInsert(db, {
      actor: options.actor,
      action: "segment.update",
      projectKey: options.projectKey,
      target: `${options.projectKey}/segments/${options.key}`,
      before: {
        contextKeys: existing.contextKeys.length,
        rules: existing.rules.length,
      },
      after: {
        contextKeys: options.draft.contextKeys.length,
        rules: options.draft.rules.length,
      },
    }),
  ]);
  return true;
}

export async function deleteSegment(
  db: DrizzleD1Database,
  options: {
    projectId: string;
    projectKey: string;
    key: string;
    actor: Actor;
  },
): Promise<boolean> {
  const existing = await db
    .select({ id: segments.id, name: segments.name })
    .from(segments)
    .where(
      and(
        eq(segments.projectId, options.projectId),
        eq(segments.key, options.key),
      ),
    )
    .get();
  if (!existing) {
    return false;
  }
  // Flag rules referencing this key stay in place and simply stop matching.
  await db.batch([
    db.delete(segments).where(eq(segments.id, existing.id)),
    changeLogInsert(db, {
      actor: options.actor,
      action: "segment.delete",
      projectKey: options.projectKey,
      target: `${options.projectKey}/segments/${options.key}`,
      before: { name: existing.name },
    }),
  ]);
  return true;
}
