/* Theme mode persisted to localStorage and resolved against the OS
   preference. The initial resolved theme is set on <html data-theme>
   by an inline script in index.html so there is no flash before React
   mounts; this module keeps it in sync afterwards. */

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "krillswitch-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    // localStorage can be unavailable (private mode); fall back to system.
  }
  return "system";
}

export function resolveMode(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") {
    return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches
      ? "dark"
      : "light";
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveMode(mode);
}

export function writeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures; the in-memory theme still applies.
  }
  applyTheme(mode);
}

export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") {
    return () => {};
  }
  const mq = matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
