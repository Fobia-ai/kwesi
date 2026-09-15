import type { ButtonHTMLAttributes } from "react";

type PillButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "accent" | "ghost";
};

export function PillButton({ variant = "accent", className = "", ...rest }: PillButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-chip px-6 py-2.5 text-sm font-medium transition-all duration-200 ease-smooth active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none";
  const variantClass =
    variant === "accent"
      ? "bg-accent text-accent-ink shadow-glass-sm hover:brightness-110"
      : "kwesi-glass text-ink hover:brightness-105";
  return <button className={`${base} ${variantClass} ${className}`} {...rest} />;
}
