import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import {
  FeatureFlagProvider,
  KRILLSWITCH_EVAL_KEY,
  KRILLSWITCH_URL,
} from "./features";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <FeatureFlagProvider
      evalKey={KRILLSWITCH_EVAL_KEY}
      baseUrl={KRILLSWITCH_URL}
    >
      <App />
    </FeatureFlagProvider>
  </StrictMode>,
);
