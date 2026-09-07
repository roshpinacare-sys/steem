/**
 * unzip.ts — minimal ZIP reader for GitHub Actions artifact archives (a
 * handful of small files, stored or deflate). Central-directory parse +
 * DecompressionStream("deflate-raw") — no dependency. Throws on anything
 * exotic (zip64, encrypted, multi-disk); callers fall back to paste-JSON.
 */

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export async function unzip(buf: ArrayBuffer): Promise<ZipEntry[]> {
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Find End Of Central Directory (scan backwards; comment ≤ 64KB).
  let eocd = -1;
  const min = Math.max(0, buf.byteLength - 65_558);
  for (let i = buf.byteLength - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory)");

  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true); // central directory offset
  const entries: ZipEntry[] = [];

  for (let n = 0; n < count; n++) {
    if (dv.getUint32(ptr, true) !== CDIR_SIG) throw new Error("corrupt central directory");
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOffset = dv.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    if (compSize === 0xffffffff || localOffset === 0xffffffff) throw new Error("zip64 archives are not supported");

    // Local header repeats name/extra lengths; data follows it.
    if (dv.getUint32(localOffset, true) !== LOCAL_SIG) throw new Error("corrupt local header");
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);

    let out: Uint8Array;
    if (method === 0) {
      out = data.slice();
    } else if (method === 8) {
      out = await inflateRaw(data);
    } else {
      throw new Error(`unsupported compression method ${method}`);
    }
    if (!name.endsWith("/")) entries.push({ name, bytes: out });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream unavailable — paste the JSON instead");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(ds);
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  return out;
}

export function zipEntryText(e: ZipEntry): string {
  return new TextDecoder("utf-8").decode(e.bytes);
}
