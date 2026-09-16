import heroArtwork from "../../assets/heroArtwork.svg";

/**
 * The hero's decorative illustration — an artist, a guitar, and a scatter of
 * musical notes. A real, designed asset (src/assets/heroArtwork.svg), not
 * generated — swap that file to change it, no code change needed.
 */
export function HeroArtwork({ className = "" }: { className?: string }) {
  return <img src={heroArtwork} alt="" className={`pointer-events-none select-none object-contain ${className}`} />;
}
