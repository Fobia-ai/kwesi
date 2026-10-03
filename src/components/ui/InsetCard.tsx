import type { HTMLAttributes } from "react";

/** The quiet inset surface used for rows and sub-sections inside a panel. */
export function InsetCard({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-[12px] bg-ink/[0.03] px-3 py-2.5 ${className}`} {...rest} />;
}
