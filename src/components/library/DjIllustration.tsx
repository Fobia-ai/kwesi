// Drop a `dj.png` / `dj.jpg` / `dj.webp` / `dj.svg` into src/assets/ to
// replace the built-in drawing below with your own illustration — picked up
// at build time, nothing else to wire.
const CUSTOM = import.meta.glob<{ default: string }>("../../assets/dj.{png,jpg,jpeg,webp,svg}", { eager: true });
const customSrc = Object.values(CUSTOM)[0]?.default;

/**
 * The hero's resident DJ: a flat cartoon figure vibing in headphones, one hand
 * to the ear cup, bobbing gently — the "someone's actually listening" touch
 * the overview panel has instead of a blank right half. Pure inline SVG so
 * it ships with no asset and picks the palette up from the theme.
 */
export function DjIllustration({ className = "" }: { className?: string }) {
  if (customSrc) {
    return <img src={customSrc} alt="" className={`pointer-events-none select-none object-contain ${className}`} />;
  }
  return (
    <svg
      viewBox="0 0 320 360"
      className={`kwesi-dj pointer-events-none select-none ${className}`}
      aria-hidden
    >
      <defs>
        <linearGradient id="dj-shirt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id="dj-glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(255 255 255 / 0.28)" />
          <stop offset="1" stopColor="rgb(255 255 255 / 0)" />
        </linearGradient>
      </defs>

      {/* floor shadow */}
      <ellipse cx="170" cy="346" rx="96" ry="9" fill="rgb(0 0 0 / 0.18)" />

      <g className="kwesi-dj-body">
        {/* torso */}
        <path
          d="M104 214c-6-46 22-78 66-80 44 2 74 34 66 84l-4 40H108z"
          fill="url(#dj-shirt)"
        />
        <path d="M120 150c14 12 40 18 60 8" fill="none" stroke="rgb(0 0 0 / 0.12)" strokeWidth="6" strokeLinecap="round" />
        {/* left arm down */}
        <path d="M108 168c-22 14-34 44-30 78" fill="none" stroke="url(#dj-shirt)" strokeWidth="26" strokeLinecap="round" />
        <path d="M78 246c-2 12 3 22 12 26" fill="none" stroke="#8d5524" strokeWidth="22" strokeLinecap="round" />
        {/* right arm up to the ear */}
        <path d="M226 170c22 4 34 22 32 44" fill="none" stroke="url(#dj-shirt)" strokeWidth="26" strokeLinecap="round" />
        <path d="M258 214c8-14 4-40-16-50" fill="none" stroke="#8d5524" strokeWidth="22" strokeLinecap="round" />
        <path d="M232 160c-6-6-10-10-8-16" fill="none" stroke="#8d5524" strokeWidth="18" strokeLinecap="round" />
        {/* legs */}
        <path d="M128 258c-4 32-6 56-6 78" fill="none" stroke="#1f2937" strokeWidth="30" strokeLinecap="round" />
        <path d="M204 258c8 30 12 54 14 78" fill="none" stroke="#1f2937" strokeWidth="30" strokeLinecap="round" />
        <path d="M108 338h34M206 338h34" stroke="#f3f4f6" strokeWidth="14" strokeLinecap="round" />
      </g>

      <g className="kwesi-dj-head">
        {/* neck */}
        <rect x="156" y="118" width="30" height="30" rx="12" fill="#8d5524" />
        {/* head */}
        <path d="M128 84c0-40 24-64 56-64s52 26 52 62c0 38-22 60-52 60s-56-22-56-58z" fill="#a0672f" />
        <path d="M136 66c6-30 30-42 50-38 22 6 40 24 44 46-16-8-30-10-46-6-18 4-34 6-48-2z" fill="#111827" />
        {/* shades */}
        <path d="M144 92h34a8 8 0 0 1 8 8v4a12 12 0 0 1-12 12h-24a12 12 0 0 1-12-12v-6a6 6 0 0 1 6-6z" fill="#111827" />
        <path d="M188 92h32a6 6 0 0 1 6 6v6a12 12 0 0 1-12 12h-20a12 12 0 0 1-12-12v-4a8 8 0 0 1 6-8z" fill="#111827" />
        <path d="M150 96h20M194 96h18" stroke="url(#dj-glow)" strokeWidth="4" strokeLinecap="round" />
        {/* smile */}
        <path d="M164 128c8 6 20 6 28 0" fill="none" stroke="#3b1f0e" strokeWidth="4" strokeLinecap="round" />
        {/* headphones */}
        <path d="M126 96c-2-44 26-72 60-72s60 30 58 74" fill="none" stroke="#f3f4f6" strokeWidth="10" strokeLinecap="round" />
        <rect x="112" y="84" width="26" height="42" rx="12" fill="#f3f4f6" />
        <rect x="118" y="90" width="14" height="30" rx="7" fill="#9ca3af" />
        <rect x="232" y="84" width="26" height="42" rx="12" fill="#f3f4f6" />
        <rect x="238" y="90" width="14" height="30" rx="7" fill="#9ca3af" />
      </g>

      {/* floating notes */}
      <g className="kwesi-dj-notes" fill="currentColor" opacity="0.55">
        <path d="M262 62c0-8 6-12 12-11v20a6 6 0 1 1-4-5.7V56c-4 0-6 3-6 6z" />
        <circle cx="286" cy="32" r="4" />
        <path d="M290 30V12l10 3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}
