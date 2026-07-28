import type { ReactNode } from "react";
import type { ThemeMode } from "../theme";
import type { ThemeControl } from "../useThemeMode";

const OPTIONS: { mode: ThemeMode; label: string; icon: ReactNode }[] = [
  {
    mode: "system",
    label: "Match system theme",
    icon: (
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
  },
  {
    mode: "light",
    label: "Light theme",
    icon: (
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
  },
  {
    mode: "dark",
    label: "Dark theme",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M13 9.3A5.2 5.2 0 0 1 6.7 3a5.2 5.2 0 1 0 6.3 6.3Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export function ThemeToggle({ theme }: { theme: ThemeControl }) {
  return (
    <fieldset className="oc-segmented theme-toggle">
      <legend className="visually-hidden">Theme</legend>
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          className="oc-segmented-item theme-tab"
          aria-pressed={theme.mode === option.mode}
          aria-label={option.label}
          data-tip={option.label}
          onClick={() => theme.setMode(option.mode)}
        >
          {option.icon}
        </button>
      ))}
    </fieldset>
  );
}
