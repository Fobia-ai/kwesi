// A minimal, hand-rolled ZIP writer (STORE method, no compression) rather
// than a new dependency (e.g. JSZip): the export package's contents are
// already-compressed audio/images or small text files, so DEFLATE buys
// little, and the STORE-only ZIP container (local file header + central
// directory + end-of-central-directory record) is a small, fully-specified
// binary format any real unzip tool (Explorer, Archive Utility, `unzip`)
// reads correctly -- consistent with this codebase's existing minimal-deps
// posture (see midiParser.ts's own note on the same tradeoff).

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = buildCrc32Table();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

class ByteBuilder {
  private chunks: Uint8Array[] = [];
  private length = 0;

  u16(n: number): void {
    this.chunks.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
    this.length += 2;
  }

  u32(n: number): void {
    this.chunks.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
    this.length += 4;
  }

  bytes(b: Uint8Array): void {
    this.chunks.push(b);
    this.length += b.length;
  }

  get size(): number {
    return this.length;
  }

  build(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

// 1980-01-01, 00:00:00 -- DOS date/time fields are required by the format
// but nothing here reads them back, so a fixed epoch is fine.
const DOS_TIME = 0;
const DOS_DATE = 0x21;
const UTF8_NAME_FLAG = 0x0800;

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const local = new ByteBuilder();
  const central = new ByteBuilder();
  const offsets: number[] = [];
  const crcs: number[] = [];
  const nameBytesList = entries.map((e) => new TextEncoder().encode(e.name));

  entries.forEach((entry, i) => {
    const nameBytes = nameBytesList[i];
    const crc = crc32(entry.data);
    crcs.push(crc);
    offsets.push(local.size);

    local.u32(0x04034b50);
    local.u16(20); // version needed to extract
    local.u16(UTF8_NAME_FLAG);
    local.u16(0); // compression method: store
    local.u16(DOS_TIME);
    local.u16(DOS_DATE);
    local.u32(crc);
    local.u32(entry.data.length); // compressed size == uncompressed (store)
    local.u32(entry.data.length);
    local.u16(nameBytes.length);
    local.u16(0); // extra field length
    local.bytes(nameBytes);
    local.bytes(entry.data);
  });

  entries.forEach((entry, i) => {
    const nameBytes = nameBytesList[i];
    central.u32(0x02014b50);
    central.u16(20); // version made by
    central.u16(20); // version needed to extract
    central.u16(UTF8_NAME_FLAG);
    central.u16(0); // compression method: store
    central.u16(DOS_TIME);
    central.u16(DOS_DATE);
    central.u32(crcs[i]);
    central.u32(entry.data.length);
    central.u32(entry.data.length);
    central.u16(nameBytes.length);
    central.u16(0); // extra field length
    central.u16(0); // comment length
    central.u16(0); // disk number start
    central.u16(0); // internal file attributes
    central.u32(0); // external file attributes
    central.u32(offsets[i]);
    central.bytes(nameBytes);
  });

  const eocd = new ByteBuilder();
  eocd.u32(0x06054b50);
  eocd.u16(0); // disk number
  eocd.u16(0); // disk with central directory start
  eocd.u16(entries.length);
  eocd.u16(entries.length);
  eocd.u32(central.size);
  eocd.u32(local.size);
  eocd.u16(0); // comment length

  const result = new ByteBuilder();
  result.bytes(local.build());
  result.bytes(central.build());
  result.bytes(eocd.build());
  return result.build();
}
