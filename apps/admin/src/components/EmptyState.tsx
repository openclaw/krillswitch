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
    <section className="oc-empty">
      <div className="oc-empty-content">
        {icon && (
          <span
            className="oc-empty-icon status-disc status-disc-accent"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <h3 className="oc-empty-title">{title}</h3>
        <p className="oc-empty-description">{description}</p>
        {action && <div className="oc-empty-actions">{action}</div>}
      </div>
    </section>
  );
}
