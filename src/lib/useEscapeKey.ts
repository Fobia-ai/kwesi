import { useEffect } from "react";

export function useEscapeKey(onEscape: () => void) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onEscape();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onEscape]);
}
