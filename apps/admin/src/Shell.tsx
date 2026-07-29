import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";
import { api, type Me } from "./api";
import krillIcon from "./assets/brand/krillswitch_icon.svg";
import {
  Brandmark,
  ChevronsLeftIcon,
  CrossIcon,
  ExitIcon,
  FolderIcon,
  GearIcon,
  ListIcon,
  LockIcon,
  MenuIcon,
  PlugIcon,
  SearchIcon,
  UsersIcon,
} from "./components/brand";
import { CommandPalette } from "./components/CommandPalette";
import { ThemeToggle } from "./components/ThemeToggle";
import type { ThemeControl } from "./useThemeMode";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");
  return (letters.join("") || name[0] || "?").toUpperCase();
}

/** Workspace/Administration link sections; rendered in the desktop rail and
 *  again inside the mobile menu (which closes itself via onNavigate). */
function NavSections({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  return (
    <>
      <section className="oc-app-navigation-section">
        <p className="oc-app-navigation-label">Workspace</p>
        <ul className="oc-app-navigation-list">
          <li>
            <NavLink
              to="/"
              end
              className="oc-app-navigation-item"
              onClick={onNavigate}
            >
              <FolderIcon className="oc-app-navigation-icon" />
              <span className="oc-app-navigation-item-label">Projects</span>
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/changelog"
              className="oc-app-navigation-item"
              onClick={onNavigate}
            >
              <ListIcon className="oc-app-navigation-icon" />
              <span className="oc-app-navigation-item-label">Change log</span>
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/connect"
              className="oc-app-navigation-item"
              onClick={onNavigate}
            >
              <PlugIcon className="oc-app-navigation-icon" />
              <span className="oc-app-navigation-item-label">Connect app</span>
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/settings"
              className="oc-app-navigation-item"
              onClick={onNavigate}
            >
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
                onClick={onNavigate}
              >
                <UsersIcon className="oc-app-navigation-icon" />
                <span className="oc-app-navigation-item-label">Members</span>
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/access/tokens"
                className="oc-app-navigation-item"
                onClick={onNavigate}
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
    </>
  );
}

function NavIdentity({ me }: { me: Me }) {
  return (
    <div className="nav-identity">
      <span className="user-avatar" aria-hidden="true">
        {initials(me.user.name)}
      </span>
      <span className="oc-app-navigation-footer-copy">
        <strong>{me.user.name}</strong>
        <small>{me.user.email}</small>
      </span>
    </div>
  );
}

/** Phone-width navigation: the rail collapses to a brand strip and this
 *  slide-over carries the links plus the identity/theme/sign-out footer. */
function MobileMenu({
  me,
  theme,
  open,
  onOpenChange,
  onSignOut,
}: {
  me: Me;
  theme: ThemeControl;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignOut: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Native <dialog>: showModal owns focus trapping, Escape, and ::backdrop;
  // the close event keeps React state in sync when the browser closes it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close; Escape is handled natively by <dialog>.
    <dialog
      ref={dialogRef}
      className="mobile-menu"
      aria-label="Menu"
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        if (event.target === dialogRef.current) onOpenChange(false);
      }}
    >
      <div className="mobile-menu-head">
        <Brandmark compact />
        <button
          type="button"
          className="mobile-nav-button"
          aria-label="Close menu"
          onClick={() => onOpenChange(false)}
        >
          <CrossIcon />
        </button>
      </div>
      <div className="mobile-menu-body">
        <NavSections me={me} onNavigate={() => onOpenChange(false)} />
      </div>
      <footer className="mobile-menu-footer">
        <NavIdentity me={me} />
        <ThemeToggle theme={theme} />
        <button
          type="button"
          className="theme-control nav-signout"
          aria-label="Sign out"
          onClick={onSignOut}
        >
          <ExitIcon className="nav-signout-glyph" />
        </button>
      </footer>
    </dialog>
  );
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
  // Rail width preference; Carapace owns the compact (icon-only) layout.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("nav-mode") === "compact",
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    localStorage.setItem("nav-mode", collapsed ? "compact" : "expanded");
  }, [collapsed]);

  async function signOut() {
    await api.signOut().catch(() => {});
    if (me.signOutUrl) {
      // Access owns the session; only its logout endpoint ends it.
      window.location.href = me.signOutUrl;
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <div
      className="oc-app-frame"
      data-navigation={collapsed ? "compact" : "expanded"}
    >
      <nav className="oc-app-navigation" aria-label="Main">
        <div className="oc-app-navigation-header">
          {/* Compact rail shows the krill mark; expanded shows the full
              wordmark (Carapace hides -title in compact, we hide -brand
              in expanded). */}
          <span className="oc-app-navigation-brand" aria-hidden="true">
            <img src={krillIcon} alt="" />
          </span>
          <span className="oc-app-navigation-title">
            <Brandmark compact />
          </span>
          <button
            type="button"
            className="mobile-nav-button mobile-search-button"
            aria-label="Search pages, projects, and flags"
            onClick={() => setPaletteOpen(true)}
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            className="mobile-nav-button mobile-menu-button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <MenuIcon />
          </button>
          <button
            type="button"
            className="oc-app-navigation-collapse"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((current) => !current)}
          >
            <ChevronsLeftIcon />
          </button>
        </div>
        <button
          type="button"
          className="nav-search"
          aria-label="Search pages, projects, and flags"
          onClick={() => setPaletteOpen(true)}
        >
          <SearchIcon className="nav-search-glyph" />
          <span className="nav-search-label">Search…</span>
          <kbd className="nav-search-kbd">⌘K</kbd>
        </button>
        <div className="oc-app-navigation-body">
          <NavSections me={me} />
        </div>
        <footer className="oc-app-navigation-footer">
          <NavIdentity me={me} />
          <ThemeToggle theme={theme} />
          <button
            type="button"
            className="nav-signout"
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
      <CommandPalette
        me={me}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
      <MobileMenu
        me={me}
        theme={theme}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onSignOut={signOut}
      />
    </div>
  );
}
