import type { Me } from "../api";
import { RoleChip } from "../components/RoleChip";
import { THEME_ICONS, THEME_LABELS } from "../components/ThemeToggle";
import type { ThemeMode } from "../theme";
import type { ThemeControl } from "../useThemeMode";

const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

export function SettingsPage({ me, theme }: { me: Me; theme: ThemeControl }) {
  return (
    <section>
      <header className="oc-page-header">
        <div>
          <h1>Settings</h1>
        </div>
      </header>

      <section className="detail-section">
        <h2>Profile</h2>
        <p className="muted section-hint">
          Accounts and roles are managed by an admin under Members.
        </p>
        <div className="form-page">
          <div className="oc-field">
            <span className="oc-field-label">Name</span>
            <span className="field-value">{me.user.name}</span>
          </div>
          <div className="oc-field">
            <span className="oc-field-label">Email</span>
            <span className="field-value">{me.user.email}</span>
          </div>
          <div className="oc-field">
            <span className="oc-field-label">Role</span>
            <span className="field-value">
              <RoleChip role={me.role} />
            </span>
          </div>
        </div>
      </section>

      <section className="detail-section">
        <h2>Appearance</h2>
        <p className="muted section-hint">
          Applies to this browser only. The control in the sidebar cycles the
          same setting.
        </p>
        <fieldset className="theme-picker">
          <legend className="visually-hidden">Color theme</legend>
          {THEME_MODES.map((mode) => (
            <label
              key={mode}
              className={`theme-picker-option ${theme.mode === mode ? "is-active" : ""}`}
            >
              <input
                type="radio"
                name="theme-mode"
                className="visually-hidden"
                checked={theme.mode === mode}
                onChange={() => theme.setMode(mode)}
              />
              <span className="theme-control-icon">{THEME_ICONS[mode]}</span>
              {THEME_LABELS[mode]}
            </label>
          ))}
        </fieldset>
      </section>

      <section className="detail-section">
        <h2>About</h2>
        <p className="muted">
          KrillSwitch is an{" "}
          <a href="https://openclaw.ai" rel="noreferrer">
            OpenClaw Foundation
          </a>{" "}
          project — open-source feature flags for agents and apps. Styled with{" "}
          <a href="https://carapace.design" rel="noreferrer">
            Carapace
          </a>
          .
        </p>
      </section>
    </section>
  );
}
