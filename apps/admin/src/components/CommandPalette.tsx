import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, type Me } from "../api";
import { SearchIcon } from "./brand";

type Command = {
  id: string;
  label: string;
  hint?: string;
  /** Extra text the filter matches beyond the label. */
  keywords?: string;
  to: string;
};

const MAX_RESULTS = 12;

function pageCommands(me: Me): Command[] {
  const pages: Command[] = [
    { id: "page-projects", label: "Projects", to: "/" },
    {
      id: "page-changelog",
      label: "Change log",
      keywords: "audit",
      to: "/changelog",
    },
    {
      id: "page-connect",
      label: "Connect your app",
      keywords: "sdk eval key snippet api",
      to: "/connect",
    },
    {
      id: "page-settings",
      label: "Settings",
      keywords: "theme profile",
      to: "/settings",
    },
  ];
  if (me.role === "admin") {
    pages.push(
      {
        id: "page-members",
        label: "Members",
        keywords: "users roles",
        to: "/access/members",
      },
      {
        id: "page-tokens",
        label: "Access tokens",
        keywords: "api",
        to: "/access/tokens",
      },
    );
  }
  return pages;
}

/** ⌘K command palette: pages, projects, and flags in one filtered list.
 *  Flags navigate through /projects/:key/flags/:flag, which resolves the
 *  project's first environment. */
export function CommandPalette({
  me,
  open,
  onOpenChange,
}: {
  me: Me;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Native <dialog>: showModal owns focus trapping, Escape, and the
  // ::backdrop the carapace palette styles.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      } else if (event.key === "Escape" && open) {
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Focus after the overlay renders.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const projects = useQuery({
    queryKey: ["project-options"],
    queryFn: () => api.projects({ limit: 100 }),
    enabled: open,
  });
  const projectKeys = (projects.data?.projects ?? []).map((p) => p.key);
  const flagIndex = useQuery({
    queryKey: ["command-flags", projectKeys.join(",")],
    enabled: open && projectKeys.length > 0,
    queryFn: async () =>
      Promise.all(
        projectKeys.map(async (key) => ({
          projectKey: key,
          flags: (await api.projectFlagKeys(key)).flags,
        })),
      ),
  });

  const commands = useMemo<Command[]>(() => {
    const list = pageCommands(me);
    for (const project of projects.data?.projects ?? []) {
      list.push({
        id: `project-${project.key}`,
        label: project.key,
        hint: project.name,
        keywords: "project",
        to: `/projects/${encodeURIComponent(project.key)}`,
      });
    }
    for (const group of flagIndex.data ?? []) {
      for (const flag of group.flags) {
        list.push({
          id: `flag-${group.projectKey}-${flag.key}`,
          label: `${group.projectKey}/${flag.key}`,
          hint: flag.name,
          keywords: "flag",
          to: `/projects/${encodeURIComponent(group.projectKey)}/flags/${encodeURIComponent(flag.key)}`,
        });
      }
    }
    return list;
  }, [me, projects.data, flagIndex.data]);

  const q = query.trim().toLowerCase();
  const results = (
    q === ""
      ? commands
      : commands.filter((command) =>
          `${command.label} ${command.hint ?? ""} ${command.keywords ?? ""}`
            .toLowerCase()
            .includes(q),
        )
  ).slice(0, MAX_RESULTS);

  function run(command: Command) {
    onOpenChange(false);
    navigate(command.to);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const command = results[activeIndex];
      if (command) run(command);
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only detects backdrop hits; Escape already closes via the native dialog.
    <dialog
      ref={dialogRef}
      className="oc-command-palette"
      aria-label="Search"
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        if (event.target === dialogRef.current) onOpenChange(false);
      }}
    >
      {open && (
        <>
          <label className="oc-command-palette-search">
            <SearchIcon />
            <input
              ref={inputRef}
              value={query}
              placeholder="Search pages, projects, and flags…"
              aria-label="Search pages, projects, and flags"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
            />
            <kbd className="palette-kbd">esc</kbd>
          </label>
          <div className="oc-command-palette-results">
            {results.length === 0 && (
              <p className="oc-command-palette-empty">No matches.</p>
            )}
            <ul className="oc-command-palette-list">
              {results.map((command, index) => (
                <li key={command.id}>
                  <button
                    type="button"
                    data-active={index === activeIndex ? "" : undefined}
                    className="oc-command-palette-item"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => run(command)}
                  >
                    <span className="oc-command-palette-item-label">
                      {command.label}
                    </span>
                    {command.hint && (
                      <span className="oc-command-palette-item-keys">
                        {command.hint}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </dialog>
  );
}
