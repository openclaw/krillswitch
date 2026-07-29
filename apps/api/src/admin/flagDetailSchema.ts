import type { FlagKind, JsonValue } from "@openclaw/krillswitch-core";
import { z } from "zod";

const flagValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(flagValueSchema),
    z.record(z.string(), flagValueSchema),
  ]),
);

const attributeValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const variationDraftSchema = z.object({
  id: z.string().optional(),
  value: flagValueSchema,
  name: z.string().trim().max(100).nullish(),
});

// References use array indexes into `variations`: new variations have no id
// yet, and the server owns id generation.
export const flagDetailUpdateSchema = z
  .object({
    enabled: z.boolean(),
    variations: z.array(variationDraftSchema).min(1).max(20),
    offVariationIndex: z.number().int().nonnegative(),
    defaultVariationIndex: z.number().int().nonnegative(),
    targets: z.array(
      z.object({
        variationIndex: z.number().int().nonnegative(),
        contextKeys: z.array(z.string().trim().min(1)).min(1),
      }),
    ),
    rules: z.array(
      z.object({
        variationIndex: z.number().int().nonnegative(),
        attribute: z.string().trim().min(1),
        values: z.array(attributeValueSchema).min(1),
      }),
    ),
    // Optional operator note for the audit log ("why this change").
    comment: z.string().trim().max(500).optional(),
    rollout: z
      .object({
        variations: z
          .array(
            z.object({
              variationIndex: z.number().int().nonnegative(),
              weight: z.number().int().min(0).max(100),
            }),
          )
          .min(1),
      })
      .nullable(),
  })
  .superRefine((draft, context) => {
    const ids = draft.variations
      .map((variation) => variation.id)
      .filter((id): id is string => id !== undefined);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "variation ids must be unique",
        path: ["variations"],
      });
    }
  });

export type FlagDetailUpdate = z.infer<typeof flagDetailUpdateSchema>;

export const flagCreateSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/,
      "keys are lowercase alphanumerics plus . _ -",
    ),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["boolean", "string", "number", "json"]),
  description: z.string().trim().max(500).nullish(),
  variations: z
    .array(variationDraftSchema.omit({ id: true }))
    .min(1)
    .max(20),
  defaultVariationIndex: z.number().int().nonnegative().default(0),
  offVariationIndex: z.number().int().nonnegative().default(0),
  enabled: z.boolean().default(false),
});

export type FlagCreate = z.infer<typeof flagCreateSchema>;

function valueMatchesKind(kind: FlagKind, value: JsonValue): boolean {
  switch (kind) {
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "json":
      return true;
  }
}

/**
 * Cross-field rules zod can't express per-kind. Returns a user-facing
 * message, or null when the draft is consistent.
 */
export function semanticError(
  kind: FlagKind,
  draft: Pick<
    FlagDetailUpdate,
    | "variations"
    | "offVariationIndex"
    | "defaultVariationIndex"
    | "targets"
    | "rules"
    | "rollout"
  >,
): string | null {
  const count = draft.variations.length;
  const inRange = (index: number) => index < count;

  for (const [position, variation] of draft.variations.entries()) {
    if (!valueMatchesKind(kind, variation.value)) {
      return `variation ${position + 1} value does not match the ${kind} flag kind`;
    }
  }
  if (!inRange(draft.offVariationIndex)) {
    return "off variation reference is out of range";
  }
  if (!inRange(draft.defaultVariationIndex)) {
    return "default variation reference is out of range";
  }
  if (draft.targets.some((target) => !inRange(target.variationIndex))) {
    return "an allowlist row references a removed variation";
  }
  if (draft.rules.some((rule) => !inRange(rule.variationIndex))) {
    return "a rule references a removed variation";
  }
  if (draft.rollout) {
    if (
      draft.rollout.variations.some(
        (rolloutVariation) => !inRange(rolloutVariation.variationIndex),
      )
    ) {
      return "the rollout references a removed variation";
    }
    const total = draft.rollout.variations.reduce(
      (sum, rolloutVariation) => sum + rolloutVariation.weight,
      0,
    );
    if (total !== 100) {
      return `rollout weights must sum to 100 (currently ${total})`;
    }
  }
  return null;
}
