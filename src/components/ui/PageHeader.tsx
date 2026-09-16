import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CurvedBackIcon } from "./icons";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
}

/**
 * Every screen's header — fixed total height (`--kwesi-header-h`) so every
 * screen's own main glass panel starts at the same vertical offset
 * regardless of whether that screen has a back link or not. A back link
 * sits directly beside the title as one bold line (an icon button, not a
 * separate small text row above it) rather than a quiet "← Back" caption
 * floating on its own — the title itself is what's being navigated away
 * from, so the arrow belongs right next to it.
 */
export function PageHeader({ title, subtitle, backTo, backLabel = "Back", actions }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <div className="mb-4 flex h-[calc(var(--kwesi-header-h)-1rem)] shrink-0 items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {backTo && (
            <button
              onClick={() => navigate(backTo)}
              aria-label={backLabel}
              title={backLabel}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-150 hover:bg-ink/[0.08]"
            >
              <CurvedBackIcon width={19} height={19} />
            </button>
          )}
          <h1 className="truncate text-2xl font-bold leading-8 tracking-tight">{title}</h1>
        </div>
        <div className={`mt-0.5 h-5 truncate text-sm leading-5 text-ink-muted ${backTo ? "pl-10" : ""}`}>
          {subtitle}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </div>
  );
}
