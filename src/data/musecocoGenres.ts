/**
 * MuseCoco's real genre vocabulary (S4_CATEGORIES in servers/musecoco/
 * server.py, reverse-engineered from the vendored inference code — see
 * manifests.ts's MuseCoco comment block). The server's match_categories()
 * silently drops anything outside this exact 22-value set, so this is
 * offered as a fixed multiselect rather than free text: typing a genre
 * that isn't one of these would previously just vanish with no feedback.
 *
 * `appGenres` maps each MuseCoco category to the src/data/genres.ts names
 * that should pre-check it when seeding from an artist's own genres —
 * label text drives the UI, but the raw `value` is what actually gets sent
 * to the server, so labels can be friendlier than the server's own token
 * names without breaking the real request shape.
 */
export interface MuseCocoGenreOption {
  value: string;
  label: string;
  appGenres: string[];
}

export const MUSECOCO_GENRE_OPTIONS: MuseCocoGenreOption[] = [
  { value: "pop_rock", label: "Pop / Rock", appGenres: ["Pop", "Rock"] },
  { value: "electronic", label: "Electronic", appGenres: ["Electronic"] },
  { value: "rap", label: "Hip-Hop", appGenres: ["Hip-Hop"] },
  { value: "rnb", label: "R&B", appGenres: ["R&B"] },
  { value: "jazz", label: "Jazz", appGenres: ["Jazz"] },
  { value: "classical", label: "Classical", appGenres: ["Classical"] },
  { value: "country", label: "Country", appGenres: ["Country"] },
  { value: "folk", label: "Folk", appGenres: ["Folk"] },
  { value: "blues", label: "Blues", appGenres: ["Blues"] },
  { value: "reggae", label: "Reggae", appGenres: ["Reggae"] },
  { value: "latin", label: "Latin", appGenres: ["Latin"] },
  { value: "international", label: "International", appGenres: ["World"] },
  { value: "new_age", label: "New Age", appGenres: [] },
  { value: "religious", label: "Religious", appGenres: [] },
  { value: "easy_listening", label: "Easy Listening", appGenres: [] },
  { value: "avant_garde", label: "Avant-Garde", appGenres: [] },
  { value: "children", label: "Children's", appGenres: [] },
  { value: "comedy_spoken", label: "Comedy / Spoken Word", appGenres: [] },
  { value: "stage", label: "Stage & Screen", appGenres: [] },
  { value: "vocal", label: "Vocal", appGenres: [] },
  { value: "holiday", label: "Holiday", appGenres: [] },
  { value: "symphony", label: "Symphony", appGenres: [] },
];

export const MUSECOCO_GENRE_AUTO_MAP: Record<string, string[]> = Object.fromEntries(
  MUSECOCO_GENRE_OPTIONS.map((o) => [o.value, o.appGenres]),
);
