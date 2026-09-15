import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
}

/**
 * Every screen's header — fixed total height (see the slot comments below)
 * so IconRail can offset by a matching amount and its floating capsule lines
 * up with each screen's own main glass panel instead of the header text
 * above it. The back-link slot is always rendered, even empty, so a screen
 * without one (Workspaces, Model Manager, Training, Settings) still reaches
 * the same height as WorkspaceDetail, which has one.
 */
export function PageHeader({ title, subtitle, backTo, backLabel = "Back", actions }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <div className="mb-4 flex h-[calc(var(--kwesi-header-h)-1rem)] shrink-0 items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="mb-1 h-4 text-xs text-ink-muted">
          {backTo && (
            <button
              onClick={() => navigate(backTo)}
              className="transition-colors duration-150 hover:text-ink"
            >
              ← {backLabel}
            </button>
          )}
        </div>
        <h1 className="truncate text-2xl font-semibold leading-8 tracking-tight">{title}</h1>
        <div className="mt-0.5 h-5 truncate text-sm leading-5 text-ink-muted">{subtitle}</div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </div>
  );
}
