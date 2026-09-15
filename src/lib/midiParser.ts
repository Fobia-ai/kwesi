// A minimal Standard MIDI File (SMF) parser — enough to extract note-on/
// note-off events for a static piano-roll view, no playback/synthesis.
//
// Considered a small npm package (e.g. `midi-file`/`@tonejs/midi`) instead
// of hand-rolling this, per kwesi.docs' minimal-deps posture (see
// servers/musicgen/README.md's dependency-archaeology precedent for the
// bar this codebase holds "is this worth a new dependency" questions to).
// The SMF header + track-chunk + variable-length-quantity + note-event
// format needed here is genuinely small (a few dozen lines, no external
// state machine or codec), and every real npm option pulls in either a
// playback engine we don't need (Tone.js) or a broader event-type surface
// (meta events, SysEx, running status edge cases for *writing* files) than
// a read-only, notes-only viewer needs. Hand-rolling keeps this a zero-new-
// dependency addition, consistent with src/lib/playerStore.tsx's own
// "plain Context/reducer, no new dependency" choice in Phase 6.

export interface MidiNote {
  pitch: number;
  velocity: number;
  startTick: number;
  endTick: number;
  channel: number;
  track: number;
}

export interface ParsedMidi {
  ticksPerBeat: number;
  notes: MidiNote[];
  durationTicks: number;
  trackCount: number;
}

class ByteReader {
  constructor(
    private readonly bytes: Uint8Array,
    public pos = 0,
  ) {}

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  uint8(): number {
    return this.bytes[this.pos++];
  }

  uint16(): number {
    const v = (this.bytes[this.pos] << 8) | this.bytes[this.pos + 1];
    this.pos += 2;
    return v;
  }

  uint32(): number {
    const v =
      (this.bytes[this.pos] << 24) |
      (this.bytes[this.pos + 1] << 16) |
      (this.bytes[this.pos + 2] << 8) |
      this.bytes[this.pos + 3];
    this.pos += 4;
    return v >>> 0;
  }

  bytesStr(len: number): string {
    let s = "";
    for (let i = 0; i < len; i += 1) s += String.fromCharCode(this.bytes[this.pos + i]);
    this.pos += len;
    return s;
  }

  skip(len: number): void {
    this.pos += len;
  }

  varLen(): number {
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const byte = this.uint8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return value >>> 0;
  }
}

export function parseMidi(bytes: Uint8Array): ParsedMidi {
  const reader = new ByteReader(bytes);
  if (reader.bytesStr(4) !== "MThd") throw new Error("Not a Standard MIDI File (missing MThd header)");
  const headerLen = reader.uint32();
  const headerEnd = reader.pos + headerLen;
  reader.uint16(); // format (0/1/2), not needed for a read-only note view
  const trackCount = reader.uint16();
  const division = reader.uint16();
  reader.pos = headerEnd;

  if (division & 0x8000) {
    throw new Error("SMPTE time division is not supported by this viewer");
  }
  const ticksPerBeat = division;

  const notes: MidiNote[] = [];
  let durationTicks = 0;
  let actualTrackCount = 0;

  for (let trackIndex = 0; trackIndex < trackCount && reader.remaining > 0; trackIndex += 1) {
    const chunkType = reader.bytesStr(4);
    const chunkLen = reader.uint32();
    const chunkEnd = reader.pos + chunkLen;
    if (chunkType !== "MTrk") {
      reader.pos = chunkEnd;
      continue;
    }
    actualTrackCount += 1;

    let tick = 0;
    let runningStatus = 0;
    const active = new Map<string, { pitch: number; velocity: number; startTick: number; channel: number }>();

    while (reader.pos < chunkEnd) {
      tick += reader.varLen();
      let status = reader.uint8();
      if (status < 0x80) {
        // running status: this byte is actually the first data byte
        reader.pos -= 1;
        status = runningStatus;
      } else {
        runningStatus = status;
      }

      if (status === 0xff) {
        reader.uint8(); // meta type
        const len = reader.varLen();
        reader.skip(len);
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const len = reader.varLen();
        reader.skip(len);
        continue;
      }

      const type = status & 0xf0;
      const channel = status & 0x0f;

      if (type === 0xc0 || type === 0xd0) {
        reader.uint8(); // program / channel pressure: single data byte
        continue;
      }

      const data1 = reader.uint8();
      const data2 = reader.uint8();
      const key = `${channel}:${data1}`;

      if (type === 0x90 && data2 > 0) {
        active.set(key, { pitch: data1, velocity: data2, startTick: tick, channel });
      } else if (type === 0x80 || (type === 0x90 && data2 === 0)) {
        const open = active.get(key);
        if (open) {
          notes.push({
            pitch: open.pitch,
            velocity: open.velocity,
            startTick: open.startTick,
            endTick: tick,
            channel: open.channel,
            track: trackIndex,
          });
          active.delete(key);
          durationTicks = Math.max(durationTicks, tick);
        }
      }
    }
    reader.pos = chunkEnd;
  }

  notes.sort((a, b) => a.startTick - b.startTick);
  return { ticksPerBeat: ticksPerBeat || 480, notes, durationTicks, trackCount: actualTrackCount };
}
