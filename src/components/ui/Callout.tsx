import type { ReactNode } from "react";
import { AlertIcon, CheckCircleIcon, InfoIcon } from "./icons";

export type CalloutTone = "info" | "success" | "warning" | "error";

const TONE: Record<CalloutTone, string> = {
  info: "bg-ink/[0.04] text-ink-muted",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  error: "bg-danger/10 text-danger",
};

/** A short status message with an icon -- for validation results, warnings and errors. */
export function Callout({ tone = "info", children, className = "" }: { tone?: CalloutTone; children: ReactNode; className?: string }) {
  const Icon = tone === "success" ? CheckCircleIcon : tone === "info" ? InfoIcon : AlertIcon;
  return (
    <div className={`flex items-start gap-2 rounded-[10px] px-3 py-2 text-xs leading-relaxed ${TONE[tone]} ${className}`}>
      <Icon width={14} height={14} className="mt-[1px] shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
