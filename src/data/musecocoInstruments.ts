/**
 * MuseCoco's real instrument vocabulary (I1S2_CATEGORIES in
 * servers/musecoco/server.py, reverse-engineered from the vendored
 * inference code — see manifests.ts's MuseCoco comment block). The
 * server's match_categories() silently drops anything outside this exact
 * 28-value set, so this is offered as a fixed multiselect rather than free
 * text — the same real bug this field had as "tags" (see the manifest
 * comment): match_categories() iterates whatever it's given, and a
 * comma-separated string iterates as individual characters, so free-typed
 * instrument text was silently never matching anything.
 *
 * Unlike MuseCoco's genre field, there's no artist-level "instruments"
 * concept to auto-populate this from (ArtistProfile only carries genres
 * and languages), so this is a plain options list with no auto-select map.
 */
export interface MuseCocoInstrumentOption {
  value: string;
  label: string;
}

export const MUSECOCO_INSTRUMENT_OPTIONS: MuseCocoInstrumentOption[] = [
  { value: "piano", label: "Piano" },
  { value: "keyboard", label: "Keyboard" },
  { value: "percussion", label: "Percussion" },
  { value: "organ", label: "Organ" },
  { value: "guitar", label: "Guitar" },
  { value: "bass", label: "Bass" },
  { value: "violin", label: "Violin" },
  { value: "viola", label: "Viola" },
  { value: "cello", label: "Cello" },
  { value: "harp", label: "Harp" },
  { value: "strings", label: "Strings" },
  { value: "voice", label: "Voice" },
  { value: "trumpet", label: "Trumpet" },
  { value: "trombone", label: "Trombone" },
  { value: "tuba", label: "Tuba" },
  { value: "horn", label: "Horn" },
  { value: "brass", label: "Brass" },
  { value: "sax", label: "Sax" },
  { value: "oboe", label: "Oboe" },
  { value: "bassoon", label: "Bassoon" },
  { value: "clarinet", label: "Clarinet" },
  { value: "piccolo", label: "Piccolo" },
  { value: "flute", label: "Flute" },
  { value: "pipe", label: "Pipe" },
  { value: "synthesizer", label: "Synthesizer" },
  { value: "ethnic_instruments", label: "Ethnic Instruments" },
  { value: "sound_effects", label: "Sound Effects" },
  { value: "drum", label: "Drum" },
];
