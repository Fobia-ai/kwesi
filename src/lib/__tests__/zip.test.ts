import { describe, it, expect } from "vitest";
import { crc32, buildZip } from "../zip";

// Reads back a STORE-only zip built by buildZip -- legitimate given the
// format's simplicity at that compression level (no inflate needed), used
// here purely to verify buildZip's own output round-trips correctly.
function readStoreZip(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const entries: { name: string; data: Uint8Array }[] = [];
  let offset = 0;
  while (offset < zip.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(zip.slice(nameStart, nameStart + nameLength));
    const data = zip.slice(dataStart, dataStart + compressedSize);
    entries.push({ name, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

describe("crc32", () => {
  it("matches the canonical CRC-32 check value for the ASCII string \"123456789\"", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("returns 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("buildZip", () => {
  it("round-trips filenames and bytes for multiple entries", () => {
    const entries = [
      { name: "metadata.json", data: new TextEncoder().encode('{"a":1}') },
      { name: "notes/lyrics.txt", data: new TextEncoder().encode("la la la") },
      { name: "binary.bin", data: new Uint8Array([0, 1, 2, 255, 254, 253]) },
    ];
    const zip = buildZip(entries);

    // Real signatures at the expected fixed offsets a compliant zip reader
    // relies on.
    expect(new DataView(zip.buffer, zip.byteOffset).getUint32(0, true)).toBe(0x04034b50);
    const eocdSignature = new DataView(zip.buffer, zip.byteOffset + zip.length - 22).getUint32(0, true);
    expect(eocdSignature).toBe(0x06054b50);

    const readBack = readStoreZip(zip);
    expect(readBack).toHaveLength(3);
    readBack.forEach((entry, i) => {
      expect(entry.name).toBe(entries[i].name);
      expect(Array.from(entry.data)).toEqual(Array.from(entries[i].data));
    });
  });

  it("produces a valid (empty) zip for zero entries", () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22); // just the end-of-central-directory record
    expect(new DataView(zip.buffer, zip.byteOffset).getUint32(0, true)).toBe(0x06054b50);
  });
});
