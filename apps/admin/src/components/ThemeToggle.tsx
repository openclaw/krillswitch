import type { ReactNode } from "react";
import type { ThemeMode } from "../theme";
import type { ThemeControl } from "../useThemeMode";

/** Theme mode icons, shared by the cycling control and the settings page. */
export const THEME_ICONS: Record<ThemeMode, ReactNode> = {
  system: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2"
        y="3"
        width="12"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M6 13.5h4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13 9.3A5.2 5.2 0 0 1 6.7 3a5.2 5.2 0 1 0 6.3 6.3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

export const THEME_LABELS: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

// Same cycle order as the carapace.design site switcher.
const ORDER: ThemeMode[] = ["light", "dark", "system"];

/** Single cycling theme control, matching the carapace.design site: one
 *  icon button showing the current mode, click advances light → dark →
 *  system. Candidate for upstreaming into Carapace as a shared component. */
export function ThemeToggle({ theme }: { theme: ThemeControl }) {
  const next =
    ORDER[(ORDER.indexOf(theme.mode) + 1) % ORDER.length] ?? "system";
  return (
    <button
      type="button"
      className="theme-control"
      aria-label={`Color theme: ${THEME_LABELS[theme.mode]}. Activate to switch to ${THEME_LABELS[next].toLowerCase()}.`}
      data-tip={`${THEME_LABELS[theme.mode]} theme`}
      onClick={() => theme.setMode(next)}
    >
      <span className="theme-control-icon">{THEME_ICONS[theme.mode]}</span>
    </button>
  );
}
