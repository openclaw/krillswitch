import type { FlagKind } from "../../api";
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
    });
  }

  return (
    <section className="detail-section">
      <h2>Variations</h2>
      <table className="data-table variations-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Value ({kind})</th>
            <th className="th-radio">Default</th>
            <th className="th-radio">Off</th>
            {!disabled && <th className="th-remove" aria-label="Remove" />}
          </tr>
        </thead>
        <tbody>
          {variations.map((variation, index) => (
            <tr key={variation.id ?? `new-${index}`}>
              <td>
                <input
                  className="input"
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
              <td className="td-radio">
                <input
                  type="radio"
                  name="default-variation"
                  aria-label={`Serve variation ${index + 1} by default`}
                  checked={defaultIndex === index}
                  disabled={disabled}
                  onChange={() =>
                    onChange({ variations, offIndex, defaultIndex: index })
                  }
                />
              </td>
              <td className="td-radio">
                <input
                  type="radio"
                  name="off-variation"
                  aria-label={`Serve variation ${index + 1} when off`}
                  checked={offIndex === index}
                  disabled={disabled}
                  onChange={() =>
                    onChange({ variations, offIndex: index, defaultIndex })
                  }
                />
              </td>
              {!disabled && (
                <td className="td-remove">
                  <button
                    type="button"
                    className="btn btn-quiet"
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
      {!disabled && (
        <button type="button" className="btn btn-quiet" onClick={addVariation}>
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
      <select
        className="input"
        aria-label={label}
        value={raw}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (kind === "json") {
    return (
      <textarea
        className="input input-json"
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
      className="input input-mono"
      aria-label={label}
      type={kind === "number" ? "number" : "text"}
      value={raw}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
