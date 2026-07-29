import type { AdminRole } from "../api";

export function RoleChip({ role }: { role: AdminRole | null }) {
  return (
    <span className={`oc-badge oc-badge-plain chip-role-${role ?? "none"}`}>
      {role ?? "no access"}
    </span>
  );
}
