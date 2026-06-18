import { useEffect, useState } from "react";
import {
  applyTheme,
  readMode,
  type ThemeMode,
  watchSystemTheme,
  writeMode,
} from "./theme";

export type ThemeControl = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

export function useThemeMode(): ThemeControl {
  const [mode, setModeState] = useState<ThemeMode>(readMode);

  useEffect(() => {
    applyTheme(mode);
    if (mode !== "system") {
      return;
    }
    return watchSystemTheme(() => applyTheme("system"));
  }, [mode]);

  function setMode(next: ThemeMode): void {
    writeMode(next);
    setModeState(next);
  }

  return { mode, setMode };
}
