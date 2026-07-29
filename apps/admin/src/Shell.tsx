import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { api, type Me } from "./api";
import {
  ChevronDownIcon,
  ExitIcon,
  FolderIcon,
  GearIcon,
  KrillMark,
  ListIcon,
  LockIcon,
  UsersIcon,
} from "./components/brand";
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
    <div className="oc-app-frame" data-navigation="expanded">
      <nav className="oc-app-navigation" aria-label="Main">
        <div className="oc-app-navigation-header">
          <span className="oc-app-navigation-brand" aria-hidden="true">
            <KrillMark />
          </span>
          <span className="oc-app-navigation-title">KrillSwitch</span>
        </div>
        <NavLink to="/" end className="oc-app-navigation-context">
          <span className="oc-app-navigation-context-icon" aria-hidden="true">
            <KrillMark />
          </span>
          <span className="oc-app-navigation-context-copy">
            <strong>KrillSwitch</strong>
            <small>Admin console</small>
          </span>
          <ChevronDownIcon className="oc-app-navigation-context-chevron" />
        </NavLink>
        <div className="oc-app-navigation-body">
          <section className="oc-app-navigation-section">
            <p className="oc-app-navigation-label">Workspace</p>
            <ul className="oc-app-navigation-list">
              <li>
                <NavLink to="/" end className="oc-app-navigation-item">
                  <FolderIcon className="oc-app-navigation-icon" />
                  <span className="oc-app-navigation-item-label">Projects</span>
                </NavLink>
              </li>
              <li>
                <NavLink to="/changelog" className="oc-app-navigation-item">
                  <ListIcon className="oc-app-navigation-icon" />
                  <span className="oc-app-navigation-item-label">
                    Change log
                  </span>
                </NavLink>
              </li>
              <li>
                <NavLink to="/settings" className="oc-app-navigation-item">
                  <GearIcon className="oc-app-navigation-icon" />
                  <span className="oc-app-navigation-item-label">Settings</span>
                </NavLink>
              </li>
            </ul>
          </section>
          {me.role === "admin" && (
            <section className="oc-app-navigation-section">
              <p className="oc-app-navigation-label">Administration</p>
              <ul className="oc-app-navigation-list">
                <li>
                  <NavLink
                    to="/access/members"
                    className="oc-app-navigation-item"
                  >
                    <UsersIcon className="oc-app-navigation-icon" />
                    <span className="oc-app-navigation-item-label">
                      Members
                    </span>
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/access/tokens"
                    className="oc-app-navigation-item"
                  >
                    <LockIcon className="oc-app-navigation-icon" />
                    <span className="oc-app-navigation-item-label">
                      Access tokens
                    </span>
                  </NavLink>
                </li>
              </ul>
            </section>
          )}
        </div>
        <footer className="oc-app-navigation-footer">
          <div className="nav-identity">
            <span className="user-avatar" aria-hidden="true">
              {initials(me.user.name)}
            </span>
            <span className="oc-app-navigation-footer-copy">
              <strong>{me.user.name}</strong>
              <small>{me.user.email}</small>
            </span>
          </div>
          <ThemeToggle theme={theme} />
          <button
            type="button"
            className="theme-control nav-signout"
            aria-label="Sign out"
            data-tip="Sign out"
            onClick={signOut}
          >
            <ExitIcon className="nav-signout-glyph" />
          </button>
        </footer>
      </nav>
      <div className="oc-app-main">
        <main className="oc-app-content">{children}</main>
      </div>
    </div>
  );
}
