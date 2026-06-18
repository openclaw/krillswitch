import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api, type TokenRole } from "../api";

type CopyState = "idle" | "copied" | "failed";

export function MintTokenPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [role, setRole] = useState<TokenRole>("editor");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const mint = useMutation({
    mutationFn: () => api.mintToken(name.trim(), role),
    onSuccess: ({ token }) => {
      setFreshToken(token);
      setRevealed(false);
      setCopyState("idle");
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  const errorMessage =
    mint.error instanceof ApiError
      ? (mint.error.serverMessage ?? "Minting the token failed.")
      : mint.isError
        ? "Minting the token failed."
        : null;
  const canSubmit = name.trim() !== "" && !mint.isPending;

  async function copyToken(): Promise<void> {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section>
      <header className="page-header">
        <div>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/access">Access</Link>
          </nav>
          <h1>Mint access token</h1>
        </div>
      </header>

      {freshToken ? (
        <div className="form-page">
          <p className="field-hint">
            Copy it now. This token is shown once and can't be retrieved later.
          </p>
          <div className="token-value-row">
            <code className="token-value">
              {revealed ? freshToken : "••••••••••••••••••••••••"}
            </code>
            <button
              type="button"
              className="btn btn-primary"
              onClick={copyToken}
            >
              Copy token
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setRevealed((current) => !current)}
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
          </div>
          <p
            className={`token-copy-state token-copy-state-${copyState}`}
            aria-live="polite"
          >
            {copyState === "copied"
              ? "Copied to clipboard."
              : copyState === "failed"
                ? "Copy failed. Reveal and copy manually."
                : " "}
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate("/access")}
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form
          className="form-page"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) mint.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="mint-name">Token name</label>
            <input
              id="mint-name"
              className="input"
              placeholder="e.g. ci-deployer"
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="mint-role">Role</label>
            <Select
              value={role}
              onValueChange={(value) =>
                setRole(value === "viewer" ? "viewer" : "editor")
              }
            >
              <SelectTrigger id="mint-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">editor</SelectItem>
                <SelectItem value="viewer">viewer</SelectItem>
              </SelectContent>
            </Select>
            <p className="field-hint">
              Tokens are for the CLI and agents — editor or viewer only, never
              admin. Revocable any time; shown once at mint.
            </p>
          </div>
          {errorMessage && (
            <p role="alert" className="save-error">
              {errorMessage}
            </p>
          )}
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canSubmit}
            >
              Mint token
            </button>
            <Link className="btn btn-quiet btn-link" to="/access">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </section>
  );
}
