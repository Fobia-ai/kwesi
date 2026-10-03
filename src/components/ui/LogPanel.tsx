import { useEffect, useRef } from "react";

/** The tail of a live process log, kept scrolled to the newest line. */
export function LogPanel({ lines, className = "" }: { lines: string[]; className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  if (lines.length === 0) return null;
  return (
    <pre
      ref={ref}
      className={`kwesi-scroll-inset max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-[8px] bg-ink/[0.05] p-2 font-mono text-[10px] leading-relaxed text-ink-muted ${className}`}
    >
      {lines.join("\n")}
    </pre>
  );
}
