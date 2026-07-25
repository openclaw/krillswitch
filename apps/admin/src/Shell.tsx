import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { api, type Me } from "./api";
import {
  ChevronDownIcon,
  FolderIcon,
  KrillMark,
  ListIcon,
  LockIcon,
  UsersIcon,
} from "./components/brand";
import { RoleChip } from "./components/RoleChip";
import { ThemeToggle } from "./components/ThemeToggle";
import type { ThemeControl } from "./useThemeMode";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");
  return (letters.join("") || name[0] || "?").toUpperCase();
}

export function Shell({
  me,
  theme,
  children,
}: {
  me: Me;
  theme: ThemeControl;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();

  async function signOut() {
    await api.signOut();
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <div className="shell" data-navigation="expanded">
      <nav className="rail" aria-label="Main">
        <div className="rail-header">
          <span className="rail-header-icon" aria-hidden="true">
            <KrillMark />
          </span>
          <span className="rail-title">KrillSwitch</span>
        </div>
        <NavLink to="/" end className="rail-context">
          <span className="rail-context-icon" aria-hidden="true">
            <KrillMark />
          </span>
          <span className="rail-context-copy">
            <strong>openclaw.ai</strong>
            <small>Production workspace</small>
          </span>
          <ChevronDownIcon className="rail-context-chevron" />
        </NavLink>
        <div className="rail-body">
          <div className="rail-section">
            <div className="rail-group">Workspace</div>
            <NavLink to="/" end className="rail-link">
              <FolderIcon className="rail-icon" />
              <span className="rail-link-label">Projects</span>
            </NavLink>
            <NavLink to="/changelog" className="rail-link">
              <ListIcon className="rail-icon" />
              <span className="rail-link-label">Change log</span>
            </NavLink>
          </div>
          {me.role === "admin" && (
            <div className="rail-section">
              <div className="rail-group">Administration</div>
              <NavLink to="/access/members" className="rail-link">
                <UsersIcon className="rail-icon" />
                <span className="rail-link-label">Members</span>
              </NavLink>
              <NavLink to="/access/tokens" className="rail-link">
                <LockIcon className="rail-icon" />
                <span className="rail-link-label">Access tokens</span>
              </NavLink>
            </div>
          )}
        </div>
        <footer className="rail-footer">
          <span className="rail-presence" aria-hidden="true" />
          <span className="rail-footer-copy">
            <strong>Gateway online</strong>
            <small>Access protected</small>
          </span>
        </footer>
      </nav>
      <div className="main-col">
        <header className="topbar">
          <div className="identity">
            <ThemeToggle theme={theme} />
            <div className="user-pill">
              <span className="user-avatar" aria-hidden="true">
                {initials(me.user.name)}
              </span>
              <span className="user-name">{me.user.name}</span>
              <RoleChip role={me.role} />
            </div>
            <button type="button" className="btn btn-quiet" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
