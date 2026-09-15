import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--kwesi-bg) / <alpha-value>)",
        ink: "rgb(var(--kwesi-ink) / <alpha-value>)",
        "ink-muted": "rgb(var(--kwesi-ink-muted) / <alpha-value>)",
        accent: "rgb(var(--kwesi-accent) / <alpha-value>)",
        "accent-ink": "rgb(var(--kwesi-accent-ink) / <alpha-value>)",
      },
      borderRadius: {
        card: "20px",
        panel: "24px",
        chip: "999px",
        credit: "6px",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Inter",
          "Segoe UI",
          "sans-serif",
        ],
      },
      boxShadow: {
        glass: "0 8px 32px -8px rgb(0 0 0 / 0.25), 0 1px 0 0 rgb(255 255 255 / 0.06) inset",
        "glass-sm": "0 2px 12px -4px rgb(0 0 0 / 0.18)",
      },
      backdropBlur: {
        glass: "24px",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
