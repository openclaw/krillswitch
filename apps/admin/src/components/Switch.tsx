/** The one on/off switch used everywhere a flag's enabled state is set
 *  (the flags table and the flag-detail header). Renders as a real
 *  role="switch" button so it reads consistently and stays keyboard- and
 *  screen-reader-operable. The state word beside it carries the color. */
export function Switch({
  checked,
  disabled,
  onChange,
  ariaLabel,
  onLabel = "On",
  offLabel = "Off",
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <label className={`flag-toggle ${checked ? "is-on" : ""}`}>
      <input
        className="flag-toggle-control"
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="flag-toggle-track" aria-hidden="true" />
      <span className="flag-toggle-copy">{checked ? onLabel : offLabel}</span>
    </label>
  );
}
