import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import { encodeWav } from "./wavEncoder";

const SAMPLE_RATE = 44100;

// Pure Tone.js synthesis, no samples/soundfonts -- keeps rendering fully
// offline and dependency-free, matching this app's local-first design
// everywhere else. This is an intentional approximation (GM *families*,
// not per-instrument fidelity) -- see servers/museformer and musecoco
// README.md-style honesty: it makes audio available and distinguishable
// by family, not a high-fidelity instrument recreation.
type Family = "keys" | "bass" | "pad" | "lead" | "plucked" | "mallet";

function familyForProgram(program: number): Family {
  if ((program >= 0 && program <= 7) || (program >= 16 && program <= 23)) return "keys";
  if (program >= 32 && program <= 39) return "bass";
  if ((program >= 40 && program <= 55) || (program >= 88 && program <= 103)) return "pad";
  if (program >= 56 && program <= 87) return "lead";
  if ((program >= 24 && program <= 31) || (program >= 104 && program <= 111)) return "plucked";
  return "mallet"; // 8-15, 112-119, and any other/unusual program number
}

function createInstrument(family: Family): Tone.PolySynth {
  switch (family) {
    case "keys":
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2,
        modulationIndex: 3,
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.15, release: 0.8 },
      }).toDestination();
    case "bass":
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 1, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3 },
      }).toDestination();
    case "pad":
      return new Tone.PolySynth(Tone.AMSynth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.5, decay: 0.3, sustain: 0.6, release: 1.8 },
      }).toDestination();
    case "lead":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.03, decay: 0.1, sustain: 0.6, release: 0.3 },
      }).toDestination();
    case "plucked":
      // Tone.PluckSynth isn't a Monophonic voice, so it can't be wrapped in
      // PolySynth (confirmed against tone's own type declarations) -- a
      // short-decay triangle synth is the plain-Synth fallback instead.
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 0.2 },
      }).toDestination();
    case "mallet":
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 14,
        envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.5 },
      }).toDestination();
  }
}

// General MIDI percussion key map (channel 10 / track.channel === 9) --
// dispatched by note number, not by instrument.number.
const KICKS = new Set([35, 36]);
const SNARES = new Set([38, 40]);
const HIHATS_CLOSED = new Set([42, 44]);
const HIHATS_OPEN = new Set([46]);
const CYMBALS = new Set([49, 51, 52, 55, 57, 59]);
const TOMS = new Set([41, 43, 45, 47, 48, 50]);

// Each drum hit gets its own fresh, single-use voice rather than sharing one
// monophonic synth per drum type. Real generated MIDI overlaps hits: a hit's
// scheduled *release* (time + duration) routinely extends past the next
// same-type hit's *attack*, and Tone's monophonic drum synths track a single
// StateTimeline that then throws "time must be greater than or equal to the
// last scheduled time" -- which crashed the whole render (verified live
// against a real output.mid, see git history). Per-hit voices sidestep that
// timeline entirely. Deliberately NO MetalSynth here: it packs ~6 FM
// oscillators per voice, and one-per-hit made a 34s piece with ~130 drum
// hits take far too long to render offline (verified live) -- filtered
// NoiseSynth gives an acceptable hat/snare/cymbal character an order of
// magnitude cheaper. Also can't just wrap these in PolySynth (NoiseSynth
// isn't a Monophonic voice).
function hatNoise(decay: number, cutoff: number): Tone.NoiseSynth {
  const filter = new Tone.Filter(cutoff, "highpass").toDestination();
  return new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay, sustain: 0 } }).connect(filter);
}

function triggerDrumHit(midiNote: number, time: number, velocity: number) {
  if (KICKS.has(midiNote)) {
    new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 6 }).toDestination().triggerAttackRelease("C2", "8n", time, velocity);
  } else if (SNARES.has(midiNote)) {
    hatNoise(0.15, 1500).triggerAttackRelease("8n", time, velocity);
  } else if (HIHATS_CLOSED.has(midiNote)) {
    hatNoise(0.04, 7000).triggerAttackRelease("32n", time, velocity);
  } else if (HIHATS_OPEN.has(midiNote)) {
    hatNoise(0.25, 7000).triggerAttackRelease("8n", time, velocity);
  } else if (CYMBALS.has(midiNote)) {
    hatNoise(1.0, 5000).triggerAttackRelease("2n", time, velocity);
  } else if (TOMS.has(midiNote)) {
    // Toms are pitched, roughly, by note number -- higher GM tom note
    // numbers are higher-pitched toms.
    const octave = 2 + Math.floor((midiNote - 41) / 3);
    new Tone.MembraneSynth({ pitchDecay: 0.1, octaves: 4 }).toDestination().triggerAttackRelease(`C${Math.min(4, Math.max(2, octave))}`, "8n", time, velocity);
  } else {
    hatNoise(0.1, 4000).triggerAttackRelease("16n", time, velocity);
  }
}

/**
 * Reads a real .mid file, schedules every track's notes into a real
 * Tone.Offline render (pure synthesis, no samples), and returns real WAV
 * bytes -- called from the audioRenderListener installed at app boot, in
 * response to the main process's per-generation render request (see
 * electron/ipc/audioRender.ts; Node has no Web Audio API, so this has to
 * run here in the renderer, not in the main-process job itself).
 */
export async function renderMidiToWav(midiPath: string): Promise<Uint8Array> {
  const read = await window.kwesi!.audio.read(midiPath);
  if (!read.ok || !read.bytes) throw new Error(read.reason ?? "Could not read MIDI file");

  // Midi's constructor accepts an ArrayLike<number> directly, so the
  // Uint8Array itself works without any manual ArrayBuffer extraction.
  const midi = new Midi(read.bytes);

  const tracksWithNotes = midi.tracks.filter((t) => t.notes.length > 0);
  if (tracksWithNotes.length === 0) throw new Error("MIDI file has no notes");

  const duration = midi.duration + 1.5; // tail margin for release decay

  const rendered = await Tone.Offline(() => {
    for (const track of tracksWithNotes) {
      if (track.channel === 9) {
        for (const note of track.notes) triggerDrumHit(note.midi, note.time, note.velocity);
      } else {
        const instrument = createInstrument(familyForProgram(track.instrument.number));
        for (const note of track.notes) {
          instrument.triggerAttackRelease(note.name, note.duration, note.time, note.velocity);
        }
      }
    }
  }, duration, 2, SAMPLE_RATE);

  const audioBuffer = rendered.get();
  if (!audioBuffer) throw new Error("Offline render produced no audio buffer");
  normalizePeak(audioBuffer);
  return encodeWav(audioBuffer);
}

// Every instrument here renders straight to destination with no shared bus
// (a Tone.Limiter/Gain bus was tried and dropped -- connecting multiple
// synths to one shared node intermittently threw "Cannot connect to
// undefined node" inside Tone.Offline, reproduced live, not worth chasing
// further when a simple post-render peak scan is just as effective and has
// no node-graph timing to get wrong). Verified live: stacking even a modest
// number of simultaneous notes/tracks produces a real peak amplitude over
// 1.0 (measured: ~1.43) without this -- real clipping/distortion in the
// output WAV. Scales every sample down together (preserves relative
// levels/mix) only when actually needed.
function normalizePeak(buffer: AudioBuffer, targetPeak = 0.95) {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak <= targetPeak || peak === 0) return;
  const gain = targetPeak / peak;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
}
