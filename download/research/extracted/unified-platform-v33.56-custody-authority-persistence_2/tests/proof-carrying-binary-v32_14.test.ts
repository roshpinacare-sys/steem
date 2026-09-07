import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBinaryArtifactV32_14, compareBinaryArtifactsV32_14, type BinaryInspectionPolicyV32_14 } from '../src/binary/proof-carrying-binary-v32_14.js';

const policy: BinaryInspectionPolicyV32_14 = {
  policyId: 'binary-intake-production-v1',
  allowedKinds: ['WASM', 'ZIP', 'PDF', 'PNG', 'JPEG', 'CBOR', 'UNKNOWN'],
  maximumBytes: 1024 * 1024,
  chunkBytes: 256,
  rejectUnknown: true,
  rejectPolyglot: true,
  rejectExecutables: false,
  rejectActivePdf: true,
  rejectArchiveTraversal: true,
  maximumArchiveEntries: 16,
  maximumCompressionRatio: 100,
  maximumEntropy: 8,
};

function zipEntry(name: string, data: Buffer, uncompressedSize = data.length): Buffer {
  const nameBytes = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([header, nameBytes, data]);
}

test('proof-carrying binary inspection binds bytes structure chunks and bounded model context', () => {
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 1, 0]);
  const report = inspectBinaryArtifactV32_14('module.wasm', wasm, policy);
  assert.equal(report.detectedKind, 'WASM');
  assert.equal(report.structure.properties.version, 1);
  assert.equal(report.verdict, 'ACCEPT');
  assert.match(report.contentDigest, /^[a-f0-9]{64}$/);
  assert.match(report.merkleRoot, /^[a-f0-9]{64}$/);
  assert.match(report.structuralDigest, /^[a-f0-9]{64}$/);
  assert.ok(report.contextProjection.length < 8193);
  assert.equal(report.contextProjection.includes(wasm.toString('hex')), false);
});

test('binary intake rejects traversal active PDF polyglots malformed structures and policy violations', () => {
  const traversal = inspectBinaryArtifactV32_14('bad.zip', zipEntry('../escape', Buffer.from('x')), policy);
  assert.equal(traversal.verdict, 'REJECT');
  assert.ok(traversal.findings.some((item) => item.code === 'zip_path_traversal'));

  const activePdf = inspectBinaryArtifactV32_14('active.pdf', Buffer.from('%PDF-1.7\n1 0 obj<</OpenAction 2 0 R /JavaScript true>>endobj\n%%EOF'), policy);
  assert.equal(activePdf.verdict, 'REJECT');
  assert.ok(activePdf.findings.some((item) => item.code === 'pdf_active_content'));

  const polyglot = inspectBinaryArtifactV32_14('polyglot.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n%%EOF\n'), zipEntry('ok', Buffer.from('x'))]), policy);
  assert.equal(polyglot.verdict, 'REJECT');
  assert.ok(polyglot.findings.some((item) => item.code === 'binary_polyglot_detected'));

  const malformedWasm = inspectBinaryArtifactV32_14('broken.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 127]), policy);
  assert.equal(malformedWasm.verdict, 'QUARANTINE');
  assert.ok(malformedWasm.findings.some((item) => item.code === 'binary_structure_invalid'));

  assert.throws(() => inspectBinaryArtifactV32_14('../bad', Buffer.from('x'), policy), /binary_artifact_name_invalid/);
  assert.throws(() => inspectBinaryArtifactV32_14('empty.bin', Buffer.alloc(0), policy), /binary_empty_forbidden/);
  assert.throws(() => inspectBinaryArtifactV32_14('large.bin', Buffer.alloc(policy.maximumBytes + 1), policy), /binary_size_limit_exceeded/);
});

test('archive limits and executable policy are causal controls', () => {
  const ratio = inspectBinaryArtifactV32_14('ratio.zip', zipEntry('large', Buffer.from('x'), 1000), { ...policy, maximumCompressionRatio: 10 });
  assert.equal(ratio.verdict, 'QUARANTINE');
  assert.ok(ratio.findings.some((item) => item.code === 'zip_extreme_compression_ratio'));

  const two = inspectBinaryArtifactV32_14('two.zip', Buffer.concat([zipEntry('a', Buffer.from('1')), zipEntry('b', Buffer.from('2'))]), { ...policy, maximumArchiveEntries: 1 });
  assert.equal(two.verdict, 'REJECT');
  assert.ok(two.findings.some((item) => item.code === 'zip_entry_limit_exceeded'));

  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  assert.equal(inspectBinaryArtifactV32_14('module.wasm', wasm, { ...policy, rejectExecutables: true }).verdict, 'REJECT');
});

test('binary delta is deterministic and identifies changed added and removed chunks', () => {
  const left = inspectBinaryArtifactV32_14('left.bin', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(600, 1), Buffer.from('\n%%EOF')]), { ...policy, rejectActivePdf: false });
  const rightBytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(256, 1), Buffer.alloc(256, 2), Buffer.alloc(300, 1), Buffer.from('\n%%EOF')]);
  const right = inspectBinaryArtifactV32_14('right.bin', rightBytes, { ...policy, rejectActivePdf: false });
  const delta = compareBinaryArtifactsV32_14(left, right);
  assert.equal(delta.equal, false);
  assert.ok(delta.changedChunks.length > 0 || delta.addedChunks.length > 0);
  assert.match(delta.deltaDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(delta, compareBinaryArtifactsV32_14(left, right));
  assert.throws(() => compareBinaryArtifactsV32_14({ ...left, contentDigest: 'bad' }, right), /binary_manifest_invalid/);
  assert.throws(() => compareBinaryArtifactsV32_14({ ...left, chunks: left.chunks.map((item, index) => index === 0 ? { ...item, index: 2 } : item) }, right), /binary_manifest_chunks_invalid/);
});

test('binary parser recognizes bounded image executable and CBOR structures', () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(64, 16); png.writeUInt32BE(32, 20);
  assert.deepEqual(inspectBinaryArtifactV32_14('x.png', png, policy).structure.properties, { width: 64, height: 32 });

  const pe = Buffer.alloc(128); pe.write('MZ'); pe.writeUInt32LE(64, 0x3c); pe.write('PE\0\0', 64, 'binary'); pe.writeUInt16LE(0x8664, 68);
  const peReport = inspectBinaryArtifactV32_14('x.exe', pe, { ...policy, allowedKinds: [...policy.allowedKinds, 'PE'] });
  assert.equal(peReport.structure.properties.machine, 0x8664);

  const cbor = Buffer.from([0xd9, 0xd9, 0xf7, 0xa1, 0x61, 0x61, 0x01]);
  assert.equal(inspectBinaryArtifactV32_14('x.cbor', cbor, policy).detectedKind, 'CBOR');

  assert.equal(inspectBinaryArtifactV32_14('rejected.bin', Buffer.from([0xaa, 0xbb, 0xcc]), policy).verdict, 'REJECT');
  const unknown = inspectBinaryArtifactV32_14('x.bin', Buffer.from([0xaa, 0xbb, 0xcc]), { ...policy, rejectUnknown: false });
  assert.equal(unknown.detectedKind, 'UNKNOWN');
  assert.equal(unknown.verdict, 'ACCEPT');
});
