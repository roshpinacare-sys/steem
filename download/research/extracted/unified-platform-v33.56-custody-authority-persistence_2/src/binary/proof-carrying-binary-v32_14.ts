import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { sha256, sha256Bytes } from '../contracts/crypto.js';

export type BinaryKind = 'WASM' | 'ELF' | 'PE' | 'MACH_O' | 'ZIP' | 'PDF' | 'PNG' | 'JPEG' | 'GZIP' | 'CBOR' | 'UNKNOWN';
export type BinaryRisk = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type BinaryVerdict = 'ACCEPT' | 'QUARANTINE' | 'REJECT';

export interface BinaryInspectionPolicyV32_14 {
  readonly policyId: string;
  readonly allowedKinds: readonly BinaryKind[];
  readonly maximumBytes: number;
  readonly chunkBytes: number;
  readonly rejectUnknown: boolean;
  readonly rejectPolyglot: boolean;
  readonly rejectExecutables: boolean;
  readonly rejectActivePdf: boolean;
  readonly rejectArchiveTraversal: boolean;
  readonly maximumArchiveEntries: number;
  readonly maximumCompressionRatio: number;
  readonly maximumEntropy: number;
}

export interface BinaryFindingV32_14 {
  readonly code: string;
  readonly risk: BinaryRisk;
  readonly offset?: number;
  readonly detail: string;
}

export interface BinaryChunkV32_14 {
  readonly index: number;
  readonly offset: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly entropy: number;
}

export interface BinaryStructureV32_14 {
  readonly kind: BinaryKind;
  readonly properties: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  readonly nestedKinds: readonly BinaryKind[];
}

export interface ProofCarryingBinaryManifestV32_14 {
  readonly schemaVersion: '32.14';
  readonly artifactName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly contentDigest: string;
  readonly policyDigest: string;
  readonly detectedKind: BinaryKind;
  readonly detectedKinds: readonly BinaryKind[];
  readonly structure: BinaryStructureV32_14;
  readonly chunks: readonly BinaryChunkV32_14[];
  readonly merkleRoot: string;
  readonly structuralDigest: string;
  readonly findings: readonly BinaryFindingV32_14[];
  readonly verdict: BinaryVerdict;
  readonly contextProjection: string;
  readonly limitations: readonly string[];
}

export interface BinaryDeltaV32_14 {
  readonly leftDigest: string;
  readonly rightDigest: string;
  readonly equal: boolean;
  readonly matchingChunks: number;
  readonly changedChunks: readonly number[];
  readonly addedChunks: readonly number[];
  readonly removedChunks: readonly number[];
  readonly chunkSimilarity: number;
  readonly deltaDigest: string;
}

const EXECUTABLE_KINDS = new Set<BinaryKind>(['WASM', 'ELF', 'PE', 'MACH_O']);

export function inspectBinaryArtifactV32_14(
  artifactName: string,
  bytes: Buffer,
  policy: BinaryInspectionPolicyV32_14,
): ProofCarryingBinaryManifestV32_14 {
  validatePolicy(policy);
  if (artifactName.trim() === '' || basename(artifactName) !== artifactName || artifactName.includes('\0')) throw new Error('binary_artifact_name_invalid');
  if (!Buffer.isBuffer(bytes)) throw new Error('binary_bytes_required');
  if (bytes.byteLength === 0) throw new Error('binary_empty_forbidden');
  if (bytes.byteLength > policy.maximumBytes) throw new Error('binary_size_limit_exceeded');

  const signatures = detectSignatures(bytes);
  const detectedKinds = [...new Set(signatures.map((item) => item.kind))];
  const detectedKind = detectedKinds[0] ?? 'UNKNOWN';
  const findings: BinaryFindingV32_14[] = [];
  if (detectedKinds.length > 1) findings.push({ code: 'binary_polyglot_detected', risk: 'HIGH', detail: detectedKinds.join(',') });
  if (detectedKind === 'UNKNOWN') findings.push({ code: 'binary_unknown_format', risk: 'MEDIUM', detail: 'No supported magic signature was found.' });

  const chunks = chunkArtifact(bytes, policy.chunkBytes);
  const maximumObservedEntropy = Math.max(...chunks.map((item) => item.entropy));
  if (maximumObservedEntropy > policy.maximumEntropy) findings.push({ code: 'binary_high_entropy', risk: 'MEDIUM', detail: maximumObservedEntropy.toFixed(6) });

  let structure: BinaryStructureV32_14;
  try {
    structure = inspectStructure(detectedKind, bytes, findings, policy);
  } catch (error) {
    findings.push({ code: 'binary_structure_invalid', risk: 'HIGH', detail: error instanceof Error ? error.message : String(error) });
    structure = { kind: detectedKind, properties: { parseStatus: 'invalid' }, nestedKinds: [] };
  }

  const allKinds = [...new Set([...detectedKinds, ...structure.nestedKinds])];
  const hardReject =
    (!policy.allowedKinds.includes(detectedKind))
    || (policy.rejectUnknown && detectedKind === 'UNKNOWN')
    || (policy.rejectPolyglot && detectedKinds.length > 1)
    || (policy.rejectExecutables && EXECUTABLE_KINDS.has(detectedKind))
    || (policy.rejectActivePdf && findings.some((item) => item.code === 'pdf_active_content'))
    || (policy.rejectArchiveTraversal && findings.some((item) => item.code.startsWith('zip_path_')))
    || findings.some((item) => item.risk === 'CRITICAL');
  const verdict: BinaryVerdict = hardReject ? 'REJECT' : findings.some((item) => item.risk === 'HIGH') ? 'QUARANTINE' : 'ACCEPT';
  const merkleRoot = computeMerkleRoot(chunks.map((item) => item.sha256));
  const policyDigest = sha256(policy);
  const structuralMaterial = { detectedKind, allKinds, structure, findings, chunkBytes: policy.chunkBytes, merkleRoot };
  const structuralDigest = sha256(structuralMaterial);

  return {
    schemaVersion: '32.14',
    artifactName,
    mediaType: mediaType(detectedKind),
    sizeBytes: bytes.byteLength,
    contentDigest: sha256Bytes(bytes),
    policyDigest,
    detectedKind,
    detectedKinds: allKinds,
    structure,
    chunks,
    merkleRoot,
    structuralDigest,
    findings,
    verdict,
    contextProjection: projectBinaryContext({ artifactName, detectedKind, sizeBytes: bytes.byteLength, merkleRoot, structure, findings, verdict }),
    limitations: [
      'static-inspection-does-not-prove-benign-runtime-behavior',
      'format-parsers-are-bounded-and-do-not-decompress-or-execute-content',
      'unknown-or-unsupported-nested-formats-require-specialist-adapters',
    ],
  };
}

export function compareBinaryArtifactsV32_14(
  left: ProofCarryingBinaryManifestV32_14,
  right: ProofCarryingBinaryManifestV32_14,
): BinaryDeltaV32_14 {
  validateManifest(left);
  validateManifest(right);
  const length = Math.max(left.chunks.length, right.chunks.length);
  const changedChunks: number[] = [];
  const addedChunks: number[] = [];
  const removedChunks: number[] = [];
  let matchingChunks = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left.chunks[index];
    const b = right.chunks[index];
    if (a === undefined) addedChunks.push(index);
    else if (b === undefined) removedChunks.push(index);
    else if (a.sha256 === b.sha256) matchingChunks += 1;
    else changedChunks.push(index);
  }
  const denominator = Math.max(left.chunks.length, right.chunks.length, 1);
  const material = {
    leftDigest: left.contentDigest,
    rightDigest: right.contentDigest,
    equal: left.contentDigest === right.contentDigest,
    matchingChunks,
    changedChunks,
    addedChunks,
    removedChunks,
    chunkSimilarity: Number((matchingChunks / denominator).toFixed(6)),
  };
  return { ...material, deltaDigest: sha256(material) };
}

function inspectStructure(kind: BinaryKind, bytes: Buffer, findings: BinaryFindingV32_14[], policy: BinaryInspectionPolicyV32_14): BinaryStructureV32_14 {
  switch (kind) {
    case 'WASM': return inspectWasm(bytes);
    case 'ELF': return inspectElf(bytes);
    case 'PE': return inspectPe(bytes);
    case 'MACH_O': return inspectMachO(bytes);
    case 'ZIP': return inspectZip(bytes, findings, policy);
    case 'PDF': return inspectPdf(bytes, findings);
    case 'PNG': return inspectPng(bytes);
    case 'JPEG': return inspectJpeg(bytes);
    case 'GZIP': return { kind, properties: { compressionMethod: bytes[2] ?? -1, flags: bytes[3] ?? -1 }, nestedKinds: [] };
    case 'CBOR': return inspectCbor(bytes);
    case 'UNKNOWN': return { kind, properties: { parseStatus: 'unsupported' }, nestedKinds: [] };
  }
}

function inspectWasm(bytes: Buffer): BinaryStructureV32_14 {
  if (bytes.byteLength < 8 || !bytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) throw new Error('wasm_magic_invalid');
  const version = bytes.readUInt32LE(4);
  let offset = 8;
  const sections: string[] = [];
  const seen = new Set<number>();
  let lastNonCustom = 0;
  while (offset < bytes.length) {
    const id = bytes[offset++];
    if (id === undefined) throw new Error('wasm_section_id_missing');
    const size = readLeb128(bytes, offset);
    offset = size.next;
    const end = offset + size.value;
    if (end > bytes.length) throw new Error('wasm_section_out_of_bounds');
    if (id !== 0) {
      if (seen.has(id)) throw new Error(`wasm_duplicate_section:${id}`);
      if (id < lastNonCustom) throw new Error(`wasm_section_order_invalid:${id}`);
      seen.add(id);
      lastNonCustom = id;
    }
    sections.push(`${id}:${size.value}`);
    offset = end;
  }
  return { kind: 'WASM', properties: { version, sectionCount: sections.length, sections }, nestedKinds: [] };
}

function inspectElf(bytes: Buffer): BinaryStructureV32_14 {
  if (bytes.length < 52) throw new Error('elf_header_truncated');
  const elfClass = bytes[4];
  const data = bytes[5];
  if (elfClass !== 1 && elfClass !== 2) throw new Error('elf_class_invalid');
  if (data !== 1 && data !== 2) throw new Error('elf_endianness_invalid');
  const little = data === 1;
  const read16 = (offset: number): number => little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  const machine = read16(18);
  const type = read16(16);
  const headerBytes = read16(elfClass === 2 ? 52 : 40);
  if (headerBytes > bytes.length) throw new Error('elf_header_size_out_of_bounds');
  return { kind: 'ELF', properties: { classBits: elfClass === 1 ? 32 : 64, littleEndian: little, type, machine, headerBytes }, nestedKinds: [] };
}

function inspectPe(bytes: Buffer): BinaryStructureV32_14 {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('pe_dos_header_invalid');
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 24 > bytes.length) throw new Error('pe_header_out_of_bounds');
  if (bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') throw new Error('pe_signature_invalid');
  const machine = bytes.readUInt16LE(peOffset + 4);
  const sectionCount = bytes.readUInt16LE(peOffset + 6);
  const timestamp = bytes.readUInt32LE(peOffset + 8);
  const optionalHeaderBytes = bytes.readUInt16LE(peOffset + 20);
  const sectionTableEnd = peOffset + 24 + optionalHeaderBytes + sectionCount * 40;
  if (sectionTableEnd > bytes.length) throw new Error('pe_section_table_out_of_bounds');
  return { kind: 'PE', properties: { machine, sectionCount, timestamp, optionalHeaderBytes, peOffset }, nestedKinds: [] };
}

function inspectMachO(bytes: Buffer): BinaryStructureV32_14 {
  if (bytes.length < 28) throw new Error('macho_header_truncated');
  const magic = bytes.readUInt32BE(0);
  const little = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const fat = magic === 0xcafebabe || magic === 0xbebafeca;
  const read32 = (offset: number): number => little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  if (fat) return { kind: 'MACH_O', properties: { fat: true, architectureCount: read32(4) }, nestedKinds: [] };
  return { kind: 'MACH_O', properties: { fat: false, littleEndian: little, cpuType: read32(4), fileType: read32(12), commandCount: read32(16) }, nestedKinds: [] };
}

function inspectZip(bytes: Buffer, findings: BinaryFindingV32_14[], policy: BinaryInspectionPolicyV32_14): BinaryStructureV32_14 {
  let offset = 0;
  let entries = 0;
  const names: string[] = [];
  const normalized = new Map<string, string>();
  let totalCompressed = 0;
  let totalUncompressed = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const flags = bytes.readUInt16LE(offset + 6);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('zip_entry_out_of_bounds');
    if ((flags & 0x08) !== 0) throw new Error('zip_streaming_descriptor_unsupported');
    const name = bytes.toString('utf8', nameStart, nameStart + nameLength);
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) findings.push({ code: 'zip_path_absolute', risk: 'CRITICAL', offset, detail: name });
    if (name.split(/[\\/]/).includes('..')) findings.push({ code: 'zip_path_traversal', risk: 'HIGH', offset, detail: name });
    if (name.includes('\\')) findings.push({ code: 'zip_path_backslash', risk: 'HIGH', offset, detail: name });
    const key = name.normalize('NFC').toLocaleLowerCase('en-US');
    const prior = normalized.get(key);
    if (prior !== undefined && prior !== name) findings.push({ code: 'zip_path_collision', risk: 'HIGH', offset, detail: `${prior}|${name}` });
    normalized.set(key, name);
    names.push(name);
    entries += 1;
    if (entries > policy.maximumArchiveEntries) findings.push({ code: 'zip_entry_limit_exceeded', risk: 'CRITICAL', offset, detail: String(entries) });
    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    offset = dataEnd;
  }
  const ratio = totalCompressed === 0 ? (totalUncompressed === 0 ? 1 : Number.POSITIVE_INFINITY) : totalUncompressed / totalCompressed;
  if (!Number.isFinite(ratio) || ratio > policy.maximumCompressionRatio) findings.push({ code: 'zip_extreme_compression_ratio', risk: 'HIGH', detail: String(ratio) });
  return { kind: 'ZIP', properties: { entries, names: names.slice(0, 128), totalCompressed, totalUncompressed, compressionRatio: Number.isFinite(ratio) ? Number(ratio.toFixed(6)) : 'infinite' }, nestedKinds: detectNestedKinds(bytes) };
}

function inspectPdf(bytes: Buffer, findings: BinaryFindingV32_14[]): BinaryStructureV32_14 {
  const text = bytes.toString('latin1');
  const version = /^%PDF-(\d\.\d)/.exec(text)?.[1];
  if (version === undefined) throw new Error('pdf_header_invalid');
  const activeMarkers = ['/JavaScript', '/JS', '/OpenAction', '/Launch', '/EmbeddedFile', '/AA'];
  const present = activeMarkers.filter((marker) => text.includes(marker));
  if (present.length > 0) findings.push({ code: 'pdf_active_content', risk: 'HIGH', detail: present.join(',') });
  if (!text.includes('%%EOF')) findings.push({ code: 'pdf_eof_missing', risk: 'HIGH', detail: 'No PDF EOF marker found.' });
  const objectCount = (text.match(/\b\d+\s+\d+\s+obj\b/g) ?? []).length;
  return { kind: 'PDF', properties: { version, objectCount, eofPresent: text.includes('%%EOF'), activeMarkers: present }, nestedKinds: detectNestedKinds(bytes) };
}

function inspectPng(bytes: Buffer): BinaryStructureV32_14 {
  if (bytes.length < 24) throw new Error('png_header_truncated');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0) throw new Error('png_dimensions_invalid');
  return { kind: 'PNG', properties: { width, height }, nestedKinds: [] };
}

function inspectJpeg(bytes: Buffer): BinaryStructureV32_14 {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) throw new Error('jpeg_segment_invalid');
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { kind: 'JPEG', properties: { precision: bytes[offset + 4] ?? 0, height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7), frameMarker: marker }, nestedKinds: [] };
    }
    offset += 2 + length;
  }
  throw new Error('jpeg_dimensions_missing');
}

function inspectCbor(bytes: Buffer): BinaryStructureV32_14 {
  const selfDescribed = looksLikeCbor(bytes);
  const payloadOffset = selfDescribed ? 3 : 0;
  const first = bytes[payloadOffset];
  if (first === undefined) throw new Error('cbor_payload_missing');
  const majorType = first >> 5;
  const additional = first & 0x1f;
  if (additional === 31) return { kind: 'CBOR', properties: { selfDescribed, majorType, indefiniteLength: true }, nestedKinds: [] };
  return { kind: 'CBOR', properties: { selfDescribed, majorType, additionalInformation: additional, indefiniteLength: false }, nestedKinds: [] };
}

function detectSignatures(bytes: Buffer): readonly { kind: BinaryKind; offset: number }[] {
  const matches: { kind: BinaryKind; offset: number }[] = [];
  const add = (kind: BinaryKind, offset: number): void => { if (!matches.some((item) => item.kind === kind)) matches.push({ kind, offset }); };
  if (bytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) add('WASM', 0);
  if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) add('ELF', 0);
  if (bytes.toString('ascii', 0, 2) === 'MZ') add('PE', 0);
  const magic = bytes.length >= 4 ? bytes.readUInt32BE(0) : 0;
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(magic)) add('MACH_O', 0);
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) add('ZIP', 0);
  if (bytes.toString('ascii', 0, 5) === '%PDF-') add('PDF', 0);
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) add('PNG', 0);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) add('JPEG', 0);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) add('GZIP', 0);
  if (looksLikeCbor(bytes)) add('CBOR', 0);
  for (const [kind, signature] of [['ZIP', Buffer.from('PK\x03\x04', 'binary')], ['PDF', Buffer.from('%PDF-', 'ascii')], ['WASM', Buffer.from([0, 97, 115, 109])]] as const) {
    const offset = bytes.indexOf(signature, 1);
    if (offset > 0) add(kind, offset);
  }
  return matches;
}

function detectNestedKinds(bytes: Buffer): readonly BinaryKind[] {
  const kinds: BinaryKind[] = [];
  for (const [kind, signature] of [['WASM', Buffer.from([0, 97, 115, 109])], ['PDF', Buffer.from('%PDF-', 'ascii')], ['ZIP', Buffer.from('PK\x03\x04', 'binary')]] as const) {
    if (bytes.indexOf(signature, 1) > 0) kinds.push(kind);
  }
  return kinds;
}

function chunkArtifact(bytes: Buffer, chunkBytes: number): readonly BinaryChunkV32_14[] {
  const chunks: BinaryChunkV32_14[] = [];
  for (let offset = 0, index = 0; offset < bytes.length; offset += chunkBytes, index += 1) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.length));
    const domain = Buffer.from(`upp-binary-chunk-v32.14:${index}:`, 'utf8');
    chunks.push({ index, offset, bytes: chunk.length, sha256: sha256Bytes(Buffer.concat([domain, chunk])), entropy: Number(entropy(chunk).toFixed(6)) });
  }
  return chunks;
}

function computeMerkleRoot(leaves: readonly string[]): string {
  if (leaves.length === 0) return sha256({ domain: 'upp-binary-merkle-v32.14', empty: true });
  let level = leaves.map((digest) => Buffer.from(digest, 'hex'));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      if (left === undefined || right === undefined) throw new Error('binary_merkle_internal_error');
      next.push(createHash('sha256').update(Buffer.from('upp-binary-merkle-node-v32.14:', 'utf8')).update(left).update(right).digest());
    }
    level = next;
  }
  const root = level[0];
  if (root === undefined) throw new Error('binary_merkle_root_missing');
  return root.toString('hex');
}

function entropy(bytes: Buffer): number {
  if (bytes.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (const byte of bytes) counts[byte] = (counts[byte] ?? 0) + 1;
  let result = 0;
  for (const count of counts) if (count > 0) { const probability = count / bytes.length; result -= probability * Math.log2(probability); }
  return result;
}

function readLeb128(bytes: Buffer, start: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let offset = start;
  for (let count = 0; count < 5; count += 1) {
    const byte = bytes[offset++];
    if (byte === undefined) throw new Error('leb128_truncated');
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: offset };
    shift += 7;
  }
  throw new Error('leb128_overflow');
}

function projectBinaryContext(input: {
  artifactName: string; detectedKind: BinaryKind; sizeBytes: number; merkleRoot: string;
  structure: BinaryStructureV32_14; findings: readonly BinaryFindingV32_14[]; verdict: BinaryVerdict;
}): string {
  const projection = {
    artifact: input.artifactName,
    kind: input.detectedKind,
    bytes: input.sizeBytes,
    merkleRoot: input.merkleRoot,
    verdict: input.verdict,
    structure: input.structure.properties,
    findings: input.findings.map((item) => `${item.risk}:${item.code}:${item.detail}`).slice(0, 64),
  };
  const text = JSON.stringify(projection);
  return text.length <= 8192 ? text : `${text.slice(0, 8160)}...<truncated>`;
}

function looksLikeCbor(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xd9 && bytes[1] === 0xd9 && bytes[2] === 0xf7;
}

function mediaType(kind: BinaryKind): string {
  return ({ WASM: 'application/wasm', ELF: 'application/vnd.upp.elf', PE: 'application/vnd.microsoft.portable-executable', MACH_O: 'application/vnd.apple.mach-o', ZIP: 'application/zip', PDF: 'application/pdf', PNG: 'image/png', JPEG: 'image/jpeg', GZIP: 'application/gzip', CBOR: 'application/cbor', UNKNOWN: 'application/octet-stream' } as const)[kind];
}

function validatePolicy(policy: BinaryInspectionPolicyV32_14): void {
  if (policy.policyId.trim() === '') throw new Error('binary_policy_id_required');
  if (policy.allowedKinds.length === 0 || new Set(policy.allowedKinds).size !== policy.allowedKinds.length) throw new Error('binary_policy_kinds_invalid');
  if (!Number.isSafeInteger(policy.maximumBytes) || policy.maximumBytes < 1) throw new Error('binary_policy_maximum_bytes_invalid');
  if (!Number.isSafeInteger(policy.chunkBytes) || policy.chunkBytes < 256 || policy.chunkBytes > 1024 * 1024) throw new Error('binary_policy_chunk_bytes_invalid');
  if (!Number.isSafeInteger(policy.maximumArchiveEntries) || policy.maximumArchiveEntries < 1) throw new Error('binary_policy_archive_entries_invalid');
  if (!Number.isFinite(policy.maximumCompressionRatio) || policy.maximumCompressionRatio < 1) throw new Error('binary_policy_compression_ratio_invalid');
  if (!Number.isFinite(policy.maximumEntropy) || policy.maximumEntropy < 0 || policy.maximumEntropy > 8) throw new Error('binary_policy_entropy_invalid');
}

function validateManifest(manifest: ProofCarryingBinaryManifestV32_14): void {
  if (manifest.schemaVersion !== '32.14' || !/^[a-f0-9]{64}$/.test(manifest.contentDigest) || !/^[a-f0-9]{64}$/.test(manifest.merkleRoot)) throw new Error('binary_manifest_invalid');
  if (manifest.chunks.some((item, index) => item.index !== index || !/^[a-f0-9]{64}$/.test(item.sha256))) throw new Error('binary_manifest_chunks_invalid');
}
