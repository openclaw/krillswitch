import type {
  FlagDetail,
  FlagKind,
  FlagUpdateBody,
  FlagValue,
} from "../../api";

export type VariationDraft = {
  id?: string;
  /** Raw editor text; parsed per flag kind on save. */
  raw: string;
  name: string;
};

export type TargetDraft = {
  /** Stable list key for unsaved rows. */
  rowId: string;
  variationIndex: number;
  keysRaw: string;
};

export type RuleDraft = {
  rowId: string;
  variationIndex: number;
  attribute: string;
  valuesRaw: string;
};

export function newRowId(): string {
  return crypto.randomUUID();
}

export type Draft = {
  enabled: boolean;
  variations: VariationDraft[];
  offIndex: number;
  defaultIndex: number;
  targets: TargetDraft[];
  rules: RuleDraft[];
  rolloutEnabled: boolean;
  /** Aligned to `variations`; only sent when rolloutEnabled. */
  weights: number[];
};

function valueToRaw(kind: FlagKind, value: FlagValue): string {
  if (kind === "json") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function toDraft(detail: FlagDetail): Draft {
  const ids = detail.variations.map((variation) => variation.id);
  const indexOf = (id: string) => Math.max(0, ids.indexOf(id));
  const weights = detail.variations.map(
    (variation) =>
      detail.config.rollout?.variations.find(
        (rolloutVariation) => rolloutVariation.variationId === variation.id,
      )?.weight ?? 0,
  );
  return {
    enabled: detail.config.enabled,
    variations: detail.variations.map((variation) => ({
      id: variation.id,
      raw: valueToRaw(detail.flag.kind, variation.value),
      name: variation.name ?? "",
    })),
    offIndex: indexOf(detail.config.offVariationId),
    defaultIndex: indexOf(detail.config.defaultVariationId),
    targets: detail.config.targets.map((target) => ({
      rowId: newRowId(),
      variationIndex: indexOf(target.variationId),
      keysRaw: target.contextKeys.join(", "),
    })),
    rules: detail.config.rules.map((rule) => ({
      rowId: newRowId(),
      variationIndex: indexOf(rule.variationId),
      attribute: rule.attribute,
      valuesRaw: rule.values.map(String).join(", "),
    })),
    rolloutEnabled: detail.config.rollout !== null,
    weights,
  };
}

function parseValue(
  kind: FlagKind,
  raw: string,
  position: number,
): { value: FlagValue } | { error: string } {
  const label = `variation ${position + 1}`;
  switch (kind) {
    case "boolean":
      if (raw === "true") return { value: true };
      if (raw === "false") return { value: false };
      return { error: `${label} must be true or false` };
    case "string":
      return { value: raw };
    case "number": {
      const parsed = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(parsed)) {
        return { error: `${label} must be a number` };
      }
      return { value: parsed };
    }
    case "json":
      try {
        return { value: JSON.parse(raw) };
      } catch {
        return { error: `${label} is not valid JSON` };
      }
  }
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** "true"/"false" and numerics compare as their typed values in rules. */
function coerceAttributeValue(entry: string): string | number | boolean {
  if (entry === "true") return true;
  if (entry === "false") return false;
  const numeric = Number(entry);
  if (entry.trim() !== "" && Number.isFinite(numeric)) return numeric;
  return entry;
}

export function fromDraft(
  draft: Draft,
  kind: FlagKind,
): { body: FlagUpdateBody } | { error: string } {
  const variations: FlagUpdateBody["variations"] = [];
  for (const [position, variation] of draft.variations.entries()) {
    const parsed = parseValue(kind, variation.raw, position);
    if ("error" in parsed) {
      return parsed;
    }
    variations.push({
      id: variation.id,
      value: parsed.value,
      name: variation.name.trim() === "" ? null : variation.name.trim(),
    });
  }
  if (variations.length === 0) {
    return { error: "a flag needs at least one variation" };
  }

  const targets: FlagUpdateBody["targets"] = [];
  for (const target of draft.targets) {
    const contextKeys = splitList(target.keysRaw);
    if (contextKeys.length === 0) {
      return { error: "an allowlist row has no user keys" };
    }
    targets.push({ variationIndex: target.variationIndex, contextKeys });
  }

  const rules: FlagUpdateBody["rules"] = [];
  for (const rule of draft.rules) {
    if (rule.attribute.trim() === "") {
      return { error: "a rule is missing its attribute name" };
    }
    const values = splitList(rule.valuesRaw).map(coerceAttributeValue);
    if (values.length === 0) {
      return { error: "a rule has no values to match" };
    }
    rules.push({
      variationIndex: rule.variationIndex,
      attribute: rule.attribute.trim(),
      values,
    });
  }

  let rollout: FlagUpdateBody["rollout"] = null;
  if (draft.rolloutEnabled) {
    const total = draft.weights.reduce((sum, weight) => sum + weight, 0);
    if (total !== 100) {
      return { error: `rollout weights must sum to 100 (currently ${total})` };
    }
    rollout = {
      variations: draft.weights.map((weight, variationIndex) => ({
        variationIndex,
        weight,
      })),
    };
  }

  return {
    body: {
      enabled: draft.enabled,
      variations,
      offVariationIndex: draft.offIndex,
      defaultVariationIndex: draft.defaultIndex,
      targets,
      rules,
      rollout,
    },
  };
}

export function variationLabel(
  variation: VariationDraft,
  position: number,
): string {
  if (variation.name.trim() !== "") return variation.name;
  if (variation.raw.trim() !== "") return variation.raw.slice(0, 30);
  return `variation ${position + 1}`;
}
