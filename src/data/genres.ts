/**
 * Fixed genre catalog — an artist profile picks a required subset of these
 * at creation (Settings > Artists), and that subset is what gets offered
 * back as choices in the generation form once that artist is selected.
 * A closed set rather than free text so an artist's "genres" stay a
 * consistent, reusable tag set across every generation attributed to them.
 */
export const GENRES = [
  "Pop",
  "Rock",
  "Hip-Hop",
  "R&B",
  "Electronic",
  "Jazz",
  "Classical",
  "Country",
  "Folk",
  "Metal",
  "Indie",
  "Ambient",
  "Reggae",
  "Blues",
  "Funk",
  "Soul",
  "Punk",
  "Latin",
  "World",
  "Lo-fi",
] as const;

export type Genre = (typeof GENRES)[number];
