import { useEffect, useRef } from "react";
import { renderAbc } from "abcjs";

interface AbcNotationRendererProps {
  abc: string;
}

/**
 * Real staff-notation rendering of ABC text via abcjs (MIT, zero runtime
 * dependencies, output is plain SVG built with DOM calls -- no innerHTML/
 * eval, so it's fine under Electron's sandboxed renderer). foregroundColor
 * "currentColor" makes the notation inherit this element's `color` instead
 * of abcjs's default black, so it follows the app's light/dark theme the
 * same way an icon does.
 */
export function AbcNotationRenderer({ abc }: AbcNotationRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";
    renderAbc(containerRef.current, abc, {
      foregroundColor: "currentColor",
    });
  }, [abc]);

  return <div ref={containerRef} className="abcjs-container inline-block min-w-full text-ink" />;
}
