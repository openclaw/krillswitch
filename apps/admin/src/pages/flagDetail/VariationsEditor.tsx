import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FlagKind } from "../../api";
import { TableFrame } from "../../components/TableFrame";
import type { VariationDraft } from "./draft";

export function VariationsEditor({
  kind,
  variations,
  offIndex,
  defaultIndex,
  disabled,
  onChange,
}: {
  kind: FlagKind;
  variations: VariationDraft[];
  offIndex: number;
  defaultIndex: number;
  disabled: boolean;
  onChange: (next: {
    variations: VariationDraft[];
    offIndex: number;
    defaultIndex: number;
    removedIndex?: number;
  }) => void;
}) {
  function patchVariation(index: number, patch: Partial<VariationDraft>) {
    onChange({
      variations: variations.map((variation, position) =>
        position === index ? { ...variation, ...patch } : variation,
      ),
      offIndex,
      defaultIndex,
    });
  }

  function addVariation() {
    onChange({
      variations: [...variations, { raw: "", name: "" }],
      offIndex,
      defaultIndex,
    });
  }

  function removeVariation(index: number) {
    const reIndex = (current: number) =>
      current === index ? 0 : current > index ? current - 1 : current;
    onChange({
      variations: variations.filter((_, position) => position !== index),
      offIndex: reIndex(offIndex),
      defaultIndex: reIndex(defaultIndex),
      removedIndex: index,
    });
  }

  return (
    <section className="detail-section">
      <h2>Variations</h2>
      <p className="section-hint">
        Choose the variation returned for each fallback case.
      </p>
      <TableFrame className="table-frame-variations">
        <table className="data-table variations-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Value ({kind})</th>
              <th className="th-serve">Returned when</th>
              {!disabled && <th className="th-remove" aria-label="Remove" />}
            </tr>
          </thead>
          <tbody>
            {variations.map((variation, index) => (
              <tr key={variation.id ?? `new-${index}`}>
                <td>
                  <input
                    className="oc-input"
                    aria-label={`Variation ${index + 1} name`}
                    value={variation.name}
                    disabled={disabled}
                    onChange={(event) =>
                      patchVariation(index, { name: event.target.value })
                    }
                  />
                </td>
                <td>
                  <VariationValueInput
                    kind={kind}
                    index={index}
                    raw={variation.raw}
                    disabled={disabled}
                    onChange={(raw) => patchVariation(index, { raw })}
                  />
                </td>
                <td className="td-serve">
                  <label className="serve-choice">
                    <input
                      type="radio"
                      name="default-variation"
                      aria-label={`Return variation ${index + 1} when the flag is on and targeting misses`}
                      checked={defaultIndex === index}
                      disabled={disabled}
                      onChange={() =>
                        onChange({ variations, offIndex, defaultIndex: index })
                      }
                    />
                    <span>
                      <strong>No target matches</strong>
                    </span>
                  </label>
                  <label className="serve-choice">
                    <input
                      type="radio"
                      name="off-variation"
                      aria-label={`Return variation ${index + 1} for all requests while the flag is off`}
                      checked={offIndex === index}
                      disabled={disabled}
                      onChange={() =>
                        onChange({ variations, offIndex: index, defaultIndex })
                      }
                    />
                    <span>
                      <strong>Flag is turned off</strong>
                    </span>
                  </label>
                </td>
                {!disabled && (
                  <td className="td-remove">
                    <button
                      type="button"
                      className="oc-action oc-action-secondary"
                      aria-label={`Remove variation ${index + 1}`}
                      disabled={variations.length <= 1}
                      onClick={() => removeVariation(index)}
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      <div className="variation-cards">
        {variations.map((variation, index) => (
          <div className="variation-card" key={variation.id ?? `new-${index}`}>
            <div className="field">
              <span className="field-label">Name</span>
              <input
                className="oc-input"
                aria-label={`Variation ${index + 1} name`}
                value={variation.name}
                disabled={disabled}
                onChange={(event) =>
                  patchVariation(index, { name: event.target.value })
                }
              />
            </div>
            <div className="field">
              <span className="field-label">Value ({kind})</span>
              <VariationValueInput
                kind={kind}
                index={index}
                raw={variation.raw}
                disabled={disabled}
                onChange={(raw) => patchVariation(index, { raw })}
              />
            </div>
            <div className="variation-serve-options">
              <label className="variation-radio-option">
                <input
                  type="radio"
                  name="default-variation-mobile"
                  checked={defaultIndex === index}
                  disabled={disabled}
                  onChange={() =>
                    onChange({ variations, offIndex, defaultIndex: index })
                  }
                />
                <span>
                  <strong>No target matches</strong>
                </span>
              </label>
              <label className="variation-radio-option">
                <input
                  type="radio"
                  name="off-variation-mobile"
                  checked={offIndex === index}
                  disabled={disabled}
                  onChange={() =>
                    onChange({ variations, offIndex: index, defaultIndex })
                  }
                />
                <span>
                  <strong>Flag is turned off</strong>
                </span>
              </label>
            </div>
            {!disabled && (
              <button
                type="button"
                className="oc-action oc-action-ghost variation-card-remove"
                aria-label={`Remove variation ${index + 1}`}
                disabled={variations.length <= 1}
                onClick={() => removeVariation(index)}
              >
                Remove variation
              </button>
            )}
          </div>
        ))}
      </div>
      {!disabled && (
        <button type="button" className="oc-action oc-action-secondary" onClick={addVariation}>
          Add variation
        </button>
      )}
    </section>
  );
}

function VariationValueInput({
  kind,
  index,
  raw,
  disabled,
  onChange,
}: {
  kind: FlagKind;
  index: number;
  raw: string;
  disabled: boolean;
  onChange: (raw: string) => void;
}) {
  const label = `Variation ${index + 1} value`;
  if (kind === "boolean") {
    return (
      <Select value={raw} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (kind === "json") {
    return (
      <textarea
        className="oc-input input-json"
        aria-label={label}
        rows={2}
        value={raw}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <input
      className="oc-input input-mono"
      aria-label={label}
      type={kind === "number" ? "number" : "text"}
      value={raw}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
