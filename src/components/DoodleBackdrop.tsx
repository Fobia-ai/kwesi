import { useEffect, useMemo, useState } from "react";

/**
 * The app's backdrop: a dotted grid with a frame of hand-drawn music doodles
 * (notes, clefs, accidentals, rests, staff squiggles) around the edges and
 * the middle left open for the app, which floats on top in glass panels.
 *
 * Original artwork, drawn as SVG paths so it themes with the palette (dots
 * and doodles use --kwesi-ink, see .kwesi-dot-grid/.kwesi-doodles) and stays
 * crisp at any size. The layout comes from a seeded generator, so it's the
 * same on every launch for a given window size.
 */

// Each symbol is drawn around (0,0) in roughly a 70x70 box.
const SYMBOLS: Record<string, JSX.Element> = {
  eighth: (
    <>
      <ellipse cx="-6" cy="16" rx="8.5" ry="6" transform="rotate(-22 -6 16)" fill="currentColor" stroke="none" />
      <path d="M2 14 V-24" />
      <path d="M2 -24 C14 -16 17 -7 10 3" />
    </>
  ),
  beamed: (
    <>
      <ellipse cx="-16" cy="16" rx="7.5" ry="5.5" transform="rotate(-22 -16 16)" fill="currentColor" stroke="none" />
      <ellipse cx="10" cy="10" rx="7.5" ry="5.5" transform="rotate(-22 10 10)" fill="currentColor" stroke="none" />
      <path d="M-9 14 V-20 M17 8 V-27" />
      <path d="M-9 -20 L17 -27 M-9 -12 L17 -19" strokeWidth="4.5" />
    </>
  ),
  quarter: (
    <>
      <ellipse cx="-5" cy="16" rx="8.5" ry="6" transform="rotate(-22 -5 16)" fill="currentColor" stroke="none" />
      <path d="M3 14 V-24" />
    </>
  ),
  half: (
    <>
      <ellipse cx="-5" cy="16" rx="8.5" ry="6" transform="rotate(-22 -5 16)" />
      <path d="M3.5 13 V-24" />
    </>
  ),
  whole: <ellipse cx="0" cy="0" rx="11" ry="7.5" transform="rotate(-18)" strokeWidth="4" />,
  sharp: (
    <>
      <path d="M-5 -18 V18 M5 -20 V16" />
      <path d="M-12 -3 L12 -9 M-12 9 L12 3" strokeWidth="4.5" />
    </>
  ),
  flat: (
    <>
      <path d="M-6 -24 V16" />
      <path d="M-6 16 C10 8 12 -6 -6 0" />
    </>
  ),
  natural: <path d="M-6 -20 V10 L6 6 M6 20 V-10 L-6 -6" />,
  treble: (
    <path d="M4 36 C-2 40 -10 36 -8 30 C-6 24 2 26 1 32 L-2 -30 C-3 -40 8 -42 9 -32 C10 -20 -4 -12 -10 -4 C-18 6 -14 20 -2 22 C8 23 14 16 12 8 C10 0 0 -2 -4 4 C-7 9 -3 14 2 13" />
  ),
  bass: (
    <>
      <circle cx="-14" cy="-6" r="4" fill="currentColor" stroke="none" />
      <path d="M-14 -9 C-10 -22 14 -22 14 -4 C14 12 0 22 -16 28" />
      <circle cx="21" cy="-11" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="21" cy="1" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  rest: <path d="M-4 -22 L7 -9 L-4 2 L7 13 C-2 9 -8 15 1 24" />,
  staff: (
    <>
      {[-16, -8, 0, 8, 16].map((y) => (
        <path key={y} d={`M-40 ${y} C-26 ${y - 4} -12 ${y + 4} 0 ${y} S26 ${y - 4} 40 ${y}`} strokeWidth="2" />
      ))}
    </>
  ),
  spark: <path d="M0 -10 L2.5 -2.5 L10 0 L2.5 2.5 L0 10 L-2.5 2.5 L-10 0 L-2.5 -2.5 Z" strokeWidth="2.5" />,
  dot: <circle cx="0" cy="0" r="3.5" fill="currentColor" stroke="none" />,
};

// Weighted so notes dominate, like the reference doodle frames.
const WEIGHTED = [
  "eighth", "eighth", "beamed", "beamed", "quarter", "half", "whole", "sharp", "flat",
  "natural", "treble", "treble", "bass", "rest", "staff", "spark", "spark", "dot",
];


function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Placement {
  id: number;
  symbol: string;
  x: number;
  y: number;
  rotate: number;
  scale: number;
  opacity: number;
}

/**
 * Lays the doodles out in real pixels for the current window, so the frame
 * always hugs the actual edges (a fixed-aspect layout scaled to cover would
 * crop the sides off a tall window). The open middle is a fixed share of the
 * window -- where the app's panels sit.
 */
export interface DoodleLayoutOptions {
  // The open middle, as fractions of the size: [x0, y0, x1, y1].
  inner?: [number, number, number, number];
  // Keep the app's page-header strip (top-left, above the panels) clear.
  headerStrip?: boolean;
  // Share of grid cells inside the open middle that still get a doodle.
  strays?: number;
}

function layout(W: number, H: number, opts: DoodleLayoutOptions = {}): Placement[] {
  const rand = mulberry32(20261004);
  const [ix0, iy0, ix1, iy1] = opts.inner ?? [0.17, 0.17, 0.83, 0.83];
  const INNER = { x0: W * ix0, y0: H * iy0, x1: W * ix1, y1: H * iy1 };
  const headerStrip = opts.headerStrip ?? true;
  const strays = opts.strays ?? 0.04;
  const cell = 92;
  const out: Placement[] = [];
  let id = 0;
  for (let gy = 0; gy * cell < H + cell; gy++) {
    for (let gx = 0; gx * cell < W + cell; gx++) {
      const x = gx * cell + (rand() - 0.5) * cell * 0.7;
      const y = gy * cell + (rand() - 0.5) * cell * 0.7;
      // Fade the density toward the open middle: inside it, only the odd
      // stray doodle; near it, about half.
      // Page headers (title + subtitle) sit on the backdrop itself, top-left
      // of the content area, so that strip stays clear like the middle.
      // ...and the header's actions on the right (New Project, free space).
      if (headerStrip && y < 105 && ((x > 70 && x < Math.max(W * 0.62, 700)) || x > W - 300)) continue;
      const inside = x > INNER.x0 && x < INNER.x1 && y > INNER.y0 && y < INNER.y1;
      const near = x > INNER.x0 - 110 && x < INNER.x1 + 110 && y > INNER.y0 - 90 && y < INNER.y1 + 90;
      const keep = inside ? rand() < strays : near ? rand() < 0.55 : rand() < 0.9;
      if (!keep) continue;
      out.push({
        id: id++,
        symbol: WEIGHTED[Math.floor(rand() * WEIGHTED.length)],
        x,
        y,
        rotate: (rand() - 0.5) * 50,
        scale: 0.7 + rand() * 0.6,
        opacity: inside ? 0.45 : 0.65 + rand() * 0.35,
      });
    }
  }
  return out;
}

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setSize({ w: window.innerWidth, h: window.innerHeight }), 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return size;
}

/** The doodle frame alone, at an explicit size (the README banner reuses it). */
export function DoodleLayer({
  width,
  height,
  className = "kwesi-doodles",
  options,
}: {
  width: number;
  height: number;
  className?: string;
  options?: DoodleLayoutOptions;
}) {
  const items = useMemo(() => layout(width, height, options), [width, height, options]);
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {items.map((p) => (
        <g key={p.id} transform={`translate(${p.x} ${p.y}) rotate(${p.rotate}) scale(${p.scale})`} opacity={p.opacity}>
          {SYMBOLS[p.symbol]}
        </g>
      ))}
    </svg>
  );
}

export function DoodleBackdrop() {
  const { w, h } = useWindowSize();
  return (
    <div className="kwesi-backdrop kwesi-dot-grid" aria-hidden="true">
      <DoodleLayer width={w} height={h} />
    </div>
  );
}
