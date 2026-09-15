import type { HTMLAttributes } from "react";

type GlassPanelProps = HTMLAttributes<HTMLDivElement> & {
  strong?: boolean;
  radius?: "card" | "panel" | "credit";
};

export function GlassPanel({
  strong,
  radius = "card",
  className = "",
  ...rest
}: GlassPanelProps) {
  const radiusClass =
    radius === "panel" ? "rounded-panel" : radius === "credit" ? "rounded-credit" : "rounded-card";
  return (
    <div
      className={`${strong ? "kwesi-glass-strong" : "kwesi-glass"} ${radiusClass} shadow-glass-sm ${className}`}
      {...rest}
    />
  );
}
