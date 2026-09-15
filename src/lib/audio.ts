export interface AudioStatResult {
  exists: boolean;
  sizeBytes: number;
}

export interface AudioReadResult {
  ok: boolean;
  bytes?: Uint8Array;
  mimeType?: string;
  reason?: string;
}

export interface AudioSaveResult {
  ok: boolean;
  path?: string;
  reason?: string;
}

export interface KwesiAudioApi {
  stat(filePath: string): Promise<AudioStatResult>;
  read(filePath: string): Promise<AudioReadResult>;
  save(filePath: string, suggestedName: string, kind: "export" | "download"): Promise<AudioSaveResult>;
  reveal(filePath: string): Promise<{ ok: boolean }>;
}

function realAudioApi(bridge: NonNullable<Window["kwesi"]>["audio"]): KwesiAudioApi {
  return {
    stat: (filePath) => bridge.stat(filePath),
    read: (filePath) => bridge.read(filePath),
    save: (filePath, suggestedName, kind) => bridge.save(filePath, suggestedName, kind),
    reveal: (filePath) => bridge.reveal(filePath),
  };
}

const MOCK_SAMPLE_RATE = 8000;
const MOCK_DURATION_SEC = 1.5;

/**
 * A minimal, valid 16-bit PCM mono WAV — silent, tiny, generated in-memory
 * rather than shipped as a binary asset. Used only by the browser-preview
 * mock below so the waveform player has something real to decode and play.
 */
export function buildSilentWav(
  sampleRate: number = MOCK_SAMPLE_RATE,
  durationSec: number = MOCK_DURATION_SEC,
): Uint8Array {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  return new Uint8Array(buffer);
}

/**
 * localStorage has no notion of real files on disk, so the mock treats
 * every request as playable and serves the same generated silent WAV —
 * good enough to exercise play/pause/seek/export UI during a plain browser
 * preview without Electron. Real empty-vs-real-audio detection only matters
 * against the Electron main process's actual file bytes.
 */
function createMockAudioApi(): KwesiAudioApi {
  const wav = buildSilentWav();

  return {
    async stat() {
      return { exists: true, sizeBytes: wav.byteLength };
    },
    async read() {
      return { ok: true, bytes: wav, mimeType: "audio/wav" };
    },
    async save(_filePath, suggestedName, kind) {
      console.log(`[mock audio] ${kind} requested for "${suggestedName}"`);
      return { ok: true, path: `/mock/${kind}/${suggestedName}` };
    },
    async reveal(filePath) {
      console.log(`[mock audio] reveal-in-folder requested for "${filePath}"`);
      return { ok: true };
    },
  };
}

export const kwesiAudio: KwesiAudioApi = window.kwesi?.audio
  ? realAudioApi(window.kwesi.audio)
  : createMockAudioApi();
