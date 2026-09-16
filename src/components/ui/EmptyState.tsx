import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-panel border border-dashed border-ink/15 p-20 text-center">
      <div className="text-ink-muted">{icon}</div>
      <p className="text-sm text-ink-muted">{title}</p>
      {action}
    </div>
  );
}
