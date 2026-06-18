import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { api, type Me } from "./api";
import {
  Brandmark,
  FolderIcon,
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
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <NavLink
          to="/"
          end
          className="rail-header"
          aria-label="krillswitch home"
        >
          <Brandmark compact />
        </NavLink>
        <NavLink to="/" end className="rail-link">
          <FolderIcon className="rail-icon" />
          Projects
        </NavLink>
        <NavLink to="/changelog" className="rail-link">
          <ListIcon className="rail-icon" />
          Change log
        </NavLink>
        {me.role === "admin" && (
          <>
            <div className="rail-group">Administration</div>
            <NavLink to="/access/members" className="rail-link">
              <UsersIcon className="rail-icon" />
              Members
            </NavLink>
            <NavLink to="/access/tokens" className="rail-link">
              <LockIcon className="rail-icon" />
              Access tokens
            </NavLink>
          </>
        )}
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
