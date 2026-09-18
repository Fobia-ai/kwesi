// Tone.Offline() returns a real Web Audio AudioBuffer, but Tone.js doesn't
// ship a WAV encoder -- Float32 PCM -> 16-bit PCM WAV is a stable, ~40-line,
// well-known algorithm (44-byte RIFF/WAVE header + interleaved Int16 via
// DataView), not worth a dependency on top of tone/@tonejs/midi.
export function encodeWav(buffer: AudioBuffer): Uint8Array {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const view = new DataView(new ArrayBuffer(44 + dataSize));
  let offset = 0;

  function writeString(s: string) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  }
  function writeUint32(v: number) {
    view.setUint32(offset, v, true);
    offset += 4;
  }
  function writeUint16(v: number) {
    view.setUint16(offset, v, true);
    offset += 2;
  }

  writeString("RIFF");
  writeUint32(36 + dataSize);
  writeString("WAVE");
  writeString("fmt ");
  writeUint32(16); // fmt chunk size
  writeUint16(1); // PCM
  writeUint16(numChannels);
  writeUint32(sampleRate);
  writeUint32(sampleRate * blockAlign); // byte rate
  writeUint16(blockAlign);
  writeUint16(bytesPerSample * 8); // bits per sample
  writeString("data");
  writeUint32(dataSize);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch));

  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][frame]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Uint8Array(view.buffer);
}
