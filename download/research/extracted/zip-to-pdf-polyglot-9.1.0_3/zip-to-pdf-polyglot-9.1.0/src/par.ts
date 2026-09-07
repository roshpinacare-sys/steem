// src/lib/polyglot/par.ts
//
// The PAR2 container: a tiny, lossless, dedup-friendly format used by the
// v2 `agent-readable` strategy to carry BINARY files inside the PDF. (Text
// files live in the PDF text layer and are not duplicated here.)
//
// Layout (all little-endian):
//   magic   : 4 bytes  "PAR2"
//   version : 1 byte   = 1
//   count   : u32      number of unique binary blobs
//   for each blob:
//     origLen : u32
//     origLen bytes (raw, uncompressed — the surrounding PDF stream is
//                   FlateDecode-filtered, so the whole container is
//                   compressed exactly once, and dedup happens before that)
//
// Reversal: the strategy's extractor inflates the PDF stream, parses this
// container, and the manifest references blobs by index. Identical binary
// files share an index (dedup).

import { concatBytes, writeU32, u32 } from "./bytes";

export const PAR2_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x32]); // "PAR2"
export const PAR2_VERSION = 1;

export interface ParBlob {
  index: number;
  bytes: Uint8Array;
}

export function buildParContainer(blobs: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(PAR2_MAGIC);
  parts.push(new Uint8Array([PAR2_VERSION]));
  const countBuf = new Uint8Array(4);
  writeU32(countBuf, 0, blobs.length);
  parts.push(countBuf);
  for (const b of blobs) {
    const lenBuf = new Uint8Array(4);
    writeU32(lenBuf, 0, b.length);
    parts.push(lenBuf);
    parts.push(b);
  }
  return concatBytes(parts);
}

export function parseParContainer(data: Uint8Array): Uint8Array[] {
  if (
    data.length < 9 ||
    data[0] !== PAR2_MAGIC[0] ||
    data[1] !== PAR2_MAGIC[1] ||
    data[2] !== PAR2_MAGIC[2] ||
    data[3] !== PAR2_MAGIC[3]
  ) {
    throw new Error("PAR2: bad magic");
  }
  const version = data[4];
  if (version !== PAR2_VERSION) {
    throw new Error("PAR2: unsupported version " + version);
  }
  const count = u32(data, 5);
  // v2.5 SECURITY FIX (SEC-03): cap blob count to prevent DoS. 1M blobs max.
  if (count > 1_000_000) {
    throw new Error(`PAR2: blob count ${count} exceeds 1M limit (possible DoS)`);
  }
  const blobs: Uint8Array[] = [];
  let p = 9;
  for (let i = 0; i < count; i++) {
    if (p + 4 > data.length) throw new Error("PAR2: truncated blob length");
    const origLen = u32(data, p);
    p += 4;
    if (p + origLen > data.length) throw new Error("PAR2: truncated blob data");
    blobs.push(data.slice(p, p + origLen));
    p += origLen;
  }
  return blobs;
}
