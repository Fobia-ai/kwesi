import type { ButtonHTMLAttributes } from "react";

type PillButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "accent" | "ghost" | "danger";
  // "sm" is the compact size for buttons inside rows and cards.
  size?: "md" | "sm";
};

export function PillButton({ variant = "accent", size = "md", className = "", ...rest }: PillButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-chip font-medium transition-all duration-200 ease-smooth active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none";
  const sizeClass = size === "sm" ? "px-3 py-1.5 text-xs" : "px-6 py-2.5 text-sm";
  const variantClass =
    variant === "accent"
      ? "bg-accent text-accent-ink shadow-glass-sm hover:brightness-110"
      : variant === "danger"
        ? "bg-red-600 text-white shadow-glass-sm hover:brightness-110"
        : "kwesi-glass text-ink hover:brightness-105";
  return <button className={`${base} ${sizeClass} ${variantClass} ${className}`} {...rest} />;
}
