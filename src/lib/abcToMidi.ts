import { synth } from "abcjs";

// abcjs.synth.getMidiFile with a raw ABC string returns an array (one entry
// per tune the string could contain, since a "tunebook" string can hold
// several X: sections) -- always length 1 for the single-tune ABC this app
// generates/reads, but the array wrapping is real API behavior, not
// something to skip. "binary" gives back genuine encoded Standard MIDI File
// bytes (verified against a real MThd/MTrk-bearing buffer), not a data URI
// or an HTML download link like abcjs's other output modes.
export function abcToMidiBytes(abc: string): Uint8Array | null {
  try {
    const result = synth.getMidiFile(abc, { midiOutputType: "binary" });
    const bytes = Array.isArray(result) ? result[0] : result;
    return bytes instanceof Uint8Array && bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}
