import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "live" | "success" | "warning" | "bad";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-ink/[0.07] text-ink-muted",
  accent: "bg-accent/10 text-accent",
  live: "bg-accent/12 text-ink",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  bad: "bg-danger/12 text-danger",
};

/** A small rounded label: statuses, model names, counts. */
export function Badge({ children, tone = "neutral", pulse = false }: { children: ReactNode; tone?: BadgeTone; pulse?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-chip px-2 py-0.5 text-[10px] font-medium tracking-wide ${TONE[tone]}`}>
      {pulse && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {children}
    </span>
  );
}
