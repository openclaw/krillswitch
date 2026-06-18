import type { ReactNode } from "react";

/**
 * Teaching empty state: what goes here, why it matters, and the action to
 * create the first item. `icon` is shown in an accent disc; `action` holds the
 * primary CTA (omitted for read-only roles or simple "no results" states).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && (
        <span className="empty-state-icon status-disc status-disc-accent">
          {icon}
        </span>
      )}
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-desc">{description}</p>
      {action && <div className="empty-state-actions">{action}</div>}
    </div>
  );
}
