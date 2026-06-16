import type { RuleDraft, TargetDraft, VariationDraft } from "./draft";
import { newRowId, variationLabel } from "./draft";

function VariationSelect({
  variations,
  value,
  disabled,
  label,
  onChange,
}: {
  variations: VariationDraft[];
  value: number;
  disabled: boolean;
  label: string;
  onChange: (index: number) => void;
}) {
  return (
    <select
      className="input"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {variations.map((variation, index) => (
        <option key={variation.id ?? `new-${index}`} value={index}>
          {variationLabel(variation, index)}
        </option>
      ))}
    </select>
  );
}

export function AllowlistEditor({
  targets,
  variations,
  disabled,
  onChange,
}: {
  targets: TargetDraft[];
  variations: VariationDraft[];
  disabled: boolean;
  onChange: (targets: TargetDraft[]) => void;
}) {
  function patch(index: number, partial: Partial<TargetDraft>) {
    onChange(
      targets.map((target, position) =>
        position === index ? { ...target, ...partial } : target,
      ),
    );
  }

  return (
    <section className="detail-section">
      <h2>User allowlist</h2>
      <p className="muted section-hint">
        Pins specific user keys to a variation. Highest targeting precedence.
      </p>
      {targets.length === 0 && <p className="muted">No allowlist entries.</p>}
      {targets.map((target, index) => (
        <div className="targeting-row" key={target.rowId}>
          <input
            className="input input-mono targeting-keys"
            aria-label={`Allowlist ${index + 1} user keys`}
            placeholder="user keys, comma separated"
            value={target.keysRaw}
            disabled={disabled}
            onChange={(event) => patch(index, { keysRaw: event.target.value })}
          />
          <span className="targeting-arrow muted">serves</span>
          <VariationSelect
            variations={variations}
            value={target.variationIndex}
            disabled={disabled}
            label={`Allowlist ${index + 1} variation`}
            onChange={(variationIndex) => patch(index, { variationIndex })}
          />
          {!disabled && (
            <button
              type="button"
              className="btn btn-quiet"
              aria-label={`Remove allowlist ${index + 1}`}
              onClick={() =>
                onChange(targets.filter((_, position) => position !== index))
              }
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() =>
            onChange([
              ...targets,
              { rowId: newRowId(), variationIndex: 0, keysRaw: "" },
            ])
          }
        >
          Add allowlist entry
        </button>
      )}
    </section>
  );
}

export function RulesEditor({
  rules,
  variations,
  disabled,
  onChange,
}: {
  rules: RuleDraft[];
  variations: VariationDraft[];
  disabled: boolean;
  onChange: (rules: RuleDraft[]) => void;
}) {
  function patch(index: number, partial: Partial<RuleDraft>) {
    onChange(
      rules.map((rule, position) =>
        position === index ? { ...rule, ...partial } : rule,
      ),
    );
  }

  return (
    <section className="detail-section">
      <h2>Attribute rules</h2>
      <p className="muted section-hint">
        Matched top to bottom after the allowlist; first match serves.
      </p>
      {rules.length === 0 && <p className="muted">No rules.</p>}
      {rules.map((rule, index) => (
        <div className="targeting-row" key={rule.rowId}>
          <span className="targeting-arrow muted">if</span>
          <input
            className="input input-mono targeting-attribute"
            aria-label={`Rule ${index + 1} attribute`}
            placeholder="attribute"
            value={rule.attribute}
            disabled={disabled}
            onChange={(event) =>
              patch(index, { attribute: event.target.value })
            }
          />
          <span className="targeting-arrow muted">in</span>
          <input
            className="input input-mono targeting-values"
            aria-label={`Rule ${index + 1} values`}
            placeholder="values, comma separated"
            value={rule.valuesRaw}
            disabled={disabled}
            onChange={(event) =>
              patch(index, { valuesRaw: event.target.value })
            }
          />
          <span className="targeting-arrow muted">serves</span>
          <VariationSelect
            variations={variations}
            value={rule.variationIndex}
            disabled={disabled}
            label={`Rule ${index + 1} variation`}
            onChange={(variationIndex) => patch(index, { variationIndex })}
          />
          {!disabled && (
            <button
              type="button"
              className="btn btn-quiet"
              aria-label={`Remove rule ${index + 1}`}
              onClick={() =>
                onChange(rules.filter((_, position) => position !== index))
              }
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() =>
            onChange([
              ...rules,
              {
                rowId: newRowId(),
                variationIndex: 0,
                attribute: "",
                valuesRaw: "",
              },
            ])
          }
        >
          Add rule
        </button>
      )}
    </section>
  );
}

export function RolloutEditor({
  enabled,
  weights,
  variations,
  disabled,
  onChange,
}: {
  enabled: boolean;
  weights: number[];
  variations: VariationDraft[];
  disabled: boolean;
  onChange: (next: { enabled: boolean; weights: number[] }) => void;
}) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  return (
    <section className="detail-section">
      <h2>Percentage rollout</h2>
      <label className="rollout-enable">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) =>
            onChange({ enabled: event.target.checked, weights })
          }
        />
        Split traffic across variations after targeting
      </label>
      {enabled && (
        <>
          <div className="rollout-weights">
            {variations.map((variation, index) => (
              <label
                className="rollout-weight"
                key={variation.id ?? `new-${index}`}
              >
                <span className="rollout-weight-name">
                  {variationLabel(variation, index)}
                </span>
                <input
                  className="input input-weight"
                  type="number"
                  min={0}
                  max={100}
                  aria-label={`Weight for ${variationLabel(variation, index)}`}
                  value={weights[index] ?? 0}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = [...weights];
                    next[index] = Number(event.target.value);
                    onChange({ enabled, weights: next });
                  }}
                />
                <span className="muted">%</span>
              </label>
            ))}
          </div>
          <p
            className={total === 100 ? "muted" : "weight-error"}
            role={total === 100 ? undefined : "alert"}
          >
            Total: {total}%{total !== 100 && ". Weights must sum to 100"}
          </p>
        </>
      )}
    </section>
  );
}
