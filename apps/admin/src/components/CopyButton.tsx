import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "./brand";

/** One-click copy for keys shown in tables and headers. The tooltip doubles
 *  as the status readout (Copy → Copied), so rows need no extra text. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be denied (permissions, insecure context); leaving the
      // tooltip on "Copy" beats claiming a copy that never happened.
    }
  }

  return (
    <button
      type="button"
      className={`oc-action oc-action-ghost copy-button ${copied ? "is-copied" : ""}`}
      data-tip={copied ? "Copied" : "Copy"}
      aria-label={`Copy ${label}`}
      onClick={copy}
    >
      {copied ? (
        <CheckIcon className="copy-glyph" />
      ) : (
        <CopyIcon className="copy-glyph" />
      )}
    </button>
  );
}
