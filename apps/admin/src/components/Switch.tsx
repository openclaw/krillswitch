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
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`flag-toggle ${checked ? "is-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="flag-toggle-track" />
      {checked ? onLabel : offLabel}
    </button>
  );
}
