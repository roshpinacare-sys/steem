import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareBinaryArtifactsV32_14,
  inspectBinaryArtifactV32_14,
  type BinaryInspectionPolicyV32_14,
  type ProofCarryingBinaryManifestV32_14,
} from '../src/binary/proof-carrying-binary-v32_14.js';
import {
  adjudicateFrontierClaimV32_14,
  chooseFrontierNextActionV32_14,
  compileFrontierContextV32_14,
  compileFrontierExecutionPlanV32_14,
  type FrontierContextCandidateV32_14,
  type FrontierTaskV32_14,
} from '../src/ai/frontier-execution-kernel-v32_14.js';
import {
  evaluateFrontierSystemV32_14,
  type FrontierCapabilityEvidenceV32_14,
  type FrontierComparativeRequirementV32_14,
} from '../src/validation/frontier-comparative-assurance-v32_14.js';
import { sha256 } from '../src/contracts/crypto.js';

const policy: BinaryInspectionPolicyV32_14 = {
  policyId: 'branch-matrix',
  allowedKinds: ['WASM', 'ELF', 'PE', 'MACH_O', 'ZIP', 'PDF', 'PNG', 'JPEG', 'GZIP', 'CBOR', 'UNKNOWN'],
  maximumBytes: 2 * 1024 * 1024,
  chunkBytes: 256,
  rejectUnknown: false,
  rejectPolyglot: false,
  rejectExecutables: false,
  rejectActivePdf: false,
  rejectArchiveTraversal: false,
  maximumArchiveEntries: 256,
  maximumCompressionRatio: 100,
  maximumEntropy: 8,
};

function zipEntry(name: string, data = Buffer.alloc(0), options: { flags?: number; compressed?: number; uncompressed?: number; extra?: Buffer } = {}): Buffer {
  const nameBytes = Buffer.from(name);
  const extra = options.extra ?? Buffer.alloc(0);
  const compressed = options.compressed ?? data.length;
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(options.flags ?? 0, 6);
  header.writeUInt32LE(compressed, 18);
  header.writeUInt32LE(options.uncompressed ?? data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(extra.length, 28);
  return Buffer.concat([header, nameBytes, extra, data]);
}

function elf(elfClass: 1 | 2, endian: 1 | 2): Buffer {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(bytes);
  bytes[4] = elfClass;
  bytes[5] = endian;
  const write16 = endian === 1 ? bytes.writeUInt16LE.bind(bytes) : bytes.writeUInt16BE.bind(bytes);
  write16(2, 16);
  write16(0x3e, 18);
  write16(elfClass === 2 ? 64 : 52, elfClass === 2 ? 52 : 40);
  return bytes;
}

function pe(options: { peOffset?: number; signature?: string; sections?: number; optional?: number; total?: number } = {}): Buffer {
  const total = options.total ?? 256;
  const bytes = Buffer.alloc(total);
  bytes.write('MZ', 0, 'ascii');
  const offset = options.peOffset ?? 64;
  bytes.writeUInt32LE(offset, 0x3c);
  if (offset + 4 <= bytes.length) bytes.write(options.signature ?? 'PE\0\0', offset, 'binary');
  if (offset + 24 <= bytes.length) {
    bytes.writeUInt16LE(0x8664, offset + 4);
    bytes.writeUInt16LE(options.sections ?? 0, offset + 6);
    bytes.writeUInt32LE(1234, offset + 8);
    bytes.writeUInt16LE(options.optional ?? 0, offset + 20);
  }
  return bytes;
}

function macho(magic: number, little: boolean): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(magic, 0);
  const write = little ? bytes.writeUInt32LE.bind(bytes) : bytes.writeUInt32BE.bind(bytes);
  write(7, 4);
  write(2, 12);
  write(3, 16);
  return bytes;
}

function jpeg(frame = true): Buffer {
  const prefix = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x11, 0x22]);
  if (!frame) return Buffer.concat([prefix, Buffer.from([0xff, 0xd9])]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8;
  sof.writeUInt16BE(32, 5); sof.writeUInt16BE(64, 7);
  return Buffer.concat([prefix, sof]);
}

function task(overrides: Partial<FrontierTaskV32_14> = {}): FrontierTaskV32_14 {
  return {
    taskId: 'branch-task', objective: 'exercise frontier branches', complexity: 0.2, uncertainty: 0.2, blastRadius: 0.2, novelty: 0.2,
    expectedDurationMinutes: 5, binaryInputs: false, externalActions: false, productionImpact: false,
    maximumContextChars: 4096, maximumOutputChars: 4096, maximumCostMicros: 10_000,
    requiredProofClasses: ['STATIC'], ...overrides,
  };
}

function context(contextId: string, cls: FrontierContextCandidateV32_14['class'], content: string, trust: FrontierContextCandidateV32_14['trust'] = 'TRUSTED', score = 0.5): FrontierContextCandidateV32_14 {
  return { contextId, class: cls, trust, content, relevance: score, novelty: score, freshness: score, evidenceRefs: [`ev:${contextId}`] };
}

const requiredContexts = [
  context('g', 'GOVERNANCE', 'governance'), context('s', 'SOURCE', 'source'), context('f', 'FAILURE', 'failure'),
  context('e', 'EVIDENCE', 'evidence'), context('p', 'PRODUCT', 'product'),
];

const digest = sha256('branch-evidence');
function capability(dimension: FrontierCapabilityEvidenceV32_14['dimension'], score: number, evidenceClass: FrontierCapabilityEvidenceV32_14['evidenceClass'], ref: string = dimension): FrontierCapabilityEvidenceV32_14 {
  return { dimension, score, evidenceClass, evidenceRef: ref, artifactDigest: digest, limitations: [] };
}

function requirement(overrides: Partial<FrontierComparativeRequirementV32_14> = {}): FrontierComparativeRequirementV32_14 {
  return { dimension: 'CODING_AND_REPAIR', minimumScore: 0.8, requiredEvidenceClasses: ['OBSERVED_CURRENT_EXECUTION'], weight: 1, critical: true, ...overrides };
}

test('binary parser covers executable endian, fat, image, compression and CBOR variants', () => {
  for (const [name, bytes, kind] of [
    ['elf32le', elf(1, 1), 'ELF'], ['elf32be', elf(1, 2), 'ELF'], ['elf64le', elf(2, 1), 'ELF'], ['elf64be', elf(2, 2), 'ELF'],
    ['macho-be', macho(0xfeedface, false), 'MACH_O'], ['macho-le', macho(0xcefaedfe, true), 'MACH_O'],
    ['macho-fat', macho(0xcafebabe, false), 'MACH_O'], ['pe', pe({ sections: 1, total: 128 }), 'PE'],
  ] as const) {
    const report = inspectBinaryArtifactV32_14(`${name}.bin`, bytes, policy);
    assert.equal(report.detectedKind, kind);
    assert.equal(report.verdict, 'ACCEPT');
  }

  const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(3, 16); png.writeUInt32BE(4, 20);
  assert.equal(inspectBinaryArtifactV32_14('image.png', png, policy).structure.properties.width, 3);
  assert.equal(inspectBinaryArtifactV32_14('image.jpg', jpeg(), policy).structure.properties.width, 64);
  assert.equal(inspectBinaryArtifactV32_14('data.gz', Buffer.from([0x1f, 0x8b, 8, 4]), policy).structure.properties.flags, 4);
  assert.equal(inspectBinaryArtifactV32_14('indefinite.cbor', Buffer.from([0xd9, 0xd9, 0xf7, 0x9f]), policy).structure.properties.indefiniteLength, true);
  const taggedIndefinite = Buffer.from([0xd9, 0xd9, 0xf7, 0xff]);
  assert.equal(inspectBinaryArtifactV32_14('tag.cbor', taggedIndefinite, policy).structure.properties.indefiniteLength, true);
});

test('binary malformed format branches fail closed into quarantine', () => {
  const malformed: Array<[string, Buffer, RegExp]> = [];
  const badElfClass = elf(1, 1); badElfClass[4] = 3; malformed.push(['bad-class.elf', badElfClass, /elf_class_invalid/]);
  const badElfEndian = elf(1, 1); badElfEndian[5] = 3; malformed.push(['bad-endian.elf', badElfEndian, /elf_endianness_invalid/]);
  const badElfSize = elf(2, 1); badElfSize.writeUInt16LE(1000, 52); malformed.push(['bad-size.elf', badElfSize, /elf_header_size_out_of_bounds/]);
  malformed.push(['short.elf', Buffer.from([0x7f, 0x45, 0x4c, 0x46]), /elf_header_truncated/]);
  malformed.push(['short.exe', Buffer.from('MZ'), /pe_dos_header_invalid/]);
  malformed.push(['oob.exe', pe({ peOffset: 250, total: 256 }), /pe_header_out_of_bounds/]);
  malformed.push(['signature.exe', pe({ signature: 'PX\0\0' }), /pe_signature_invalid/]);
  malformed.push(['sections.exe', pe({ sections: 8, optional: 100, total: 128 }), /pe_section_table_out_of_bounds/]);
  const shortMach = Buffer.alloc(4); shortMach.writeUInt32BE(0xfeedface); malformed.push(['short.macho', shortMach, /macho_header_truncated/]);
  const shortPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); malformed.push(['short.png', shortPng, /png_header_truncated/]);
  const zeroPng = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(zeroPng); malformed.push(['zero.png', zeroPng, /png_dimensions_invalid/]);
  malformed.push(['noframe.jpg', jpeg(false), /jpeg_dimensions_missing/]);
  malformed.push(['badsegment.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]), /jpeg_segment_invalid/]);
  malformed.push(['leb.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 0x80]), /leb128_truncated/]);
  malformed.push(['overflow.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 0x80, 0x80, 0x80, 0x80, 0x80]), /leb128_overflow/]);
  malformed.push(['oob.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 0]), /wasm_section_out_of_bounds/]);
  malformed.push(['duplicate.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 0, 1, 0]), /wasm_duplicate_section/]);
  malformed.push(['order.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 2, 0, 1, 0]), /wasm_section_order_invalid/]);
  malformed.push(['empty-payload.cbor', Buffer.from([0xd9, 0xd9, 0xf7]), /cbor_payload_missing/]);
  for (const [name, bytes, reason] of malformed) {
    const report = inspectBinaryArtifactV32_14(name, bytes, policy);
    assert.equal(report.verdict, 'QUARANTINE', name);
    assert.match(report.findings.find((item) => item.code === 'binary_structure_invalid')?.detail ?? '', reason, name);
  }
});

test('archive parser proves path, collision, ratio, streaming, bounds and nested format controls', () => {
  const paths = Buffer.concat([
    zipEntry('/absolute'), zipEntry('C:/drive'), zipEntry('../escape'), zipEntry('dir\\escape'), zipEntry('Readme'), zipEntry('README'),
  ]);
  const pathReport = inspectBinaryArtifactV32_14('paths.zip', paths, { ...policy, maximumArchiveEntries: 4 });
  for (const code of ['zip_path_absolute', 'zip_path_traversal', 'zip_path_backslash', 'zip_path_collision', 'zip_entry_limit_exceeded']) {
    assert.ok(pathReport.findings.some((item) => item.code === code), code);
  }
  assert.equal(pathReport.verdict, 'REJECT');

  const infinite = inspectBinaryArtifactV32_14('ratio.zip', zipEntry('zero', Buffer.alloc(0), { uncompressed: 20 }), policy);
  assert.equal(infinite.structure.properties.compressionRatio, 'infinite');
  assert.ok(infinite.findings.some((item) => item.code === 'zip_extreme_compression_ratio'));

  const nested = inspectBinaryArtifactV32_14('nested.zip', zipEntry('payload', Buffer.from('%PDF-1.7\n%%EOF')), policy);
  assert.ok(nested.structure.nestedKinds.includes('PDF'));

  const streaming = zipEntry('stream', Buffer.alloc(0), { flags: 0x08 });
  assert.match(inspectBinaryArtifactV32_14('stream.zip', streaming, policy).findings.find((item) => item.code === 'binary_structure_invalid')?.detail ?? '', /zip_streaming_descriptor_unsupported/);
  const oob = zipEntry('oob', Buffer.alloc(0), { compressed: 50 });
  assert.match(inspectBinaryArtifactV32_14('oob.zip', oob, policy).findings.find((item) => item.code === 'binary_structure_invalid')?.detail ?? '', /zip_entry_out_of_bounds/);
});

test('PDF policy, polyglot, entropy, allowed-kind and projection branches are explicit', () => {
  const missingEof = inspectBinaryArtifactV32_14('missing.pdf', Buffer.from('%PDF-1.7\n1 0 obj<</Launch true /AA true>>endobj'), policy);
  assert.equal(missingEof.verdict, 'QUARANTINE');
  assert.ok(missingEof.findings.some((item) => item.code === 'pdf_eof_missing'));
  const activeRejected = inspectBinaryArtifactV32_14('active.pdf', Buffer.from('%PDF-1.7\n/OpenAction /EmbeddedFile /JS\n%%EOF'), { ...policy, rejectActivePdf: true });
  assert.equal(activeRejected.verdict, 'REJECT');
  const allowedActive = inspectBinaryArtifactV32_14('allowed.pdf', Buffer.from('%PDF-1.7\n/JavaScript\n%%EOF'), policy);
  assert.equal(allowedActive.verdict, 'QUARANTINE');

  const polyglot = inspectBinaryArtifactV32_14('poly.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n%%EOF\n'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])]), { ...policy, rejectPolyglot: true });
  assert.equal(polyglot.verdict, 'REJECT');
  assert.ok(polyglot.detectedKinds.includes('WASM'));

  const entropy = inspectBinaryArtifactV32_14('entropy.bin', Buffer.from(Array.from({ length: 256 }, (_, i) => i)), { ...policy, maximumEntropy: 0 });
  assert.ok(entropy.findings.some((item) => item.code === 'binary_high_entropy'));
  assert.equal(inspectBinaryArtifactV32_14('not-allowed.png', (() => { const b = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(b); b.writeUInt32BE(1,16); b.writeUInt32BE(1,20); return b; })(), { ...policy, allowedKinds: ['PDF'] }).verdict, 'REJECT');

  const many = Buffer.concat(Array.from({ length: 70 }, (_, i) => zipEntry(`/very-long-${i}-${'x'.repeat(120)}`)));
  const projection = inspectBinaryArtifactV32_14('many.zip', many, { ...policy, maximumArchiveEntries: 100 });
  assert.ok(projection.contextProjection.length <= 8192);
  assert.match(projection.contextProjection, /<truncated>$/);
});

test('binary validation and delta branches reject malformed identities and classify all chunk changes', () => {
  const invalidPolicies: Array<[Partial<BinaryInspectionPolicyV32_14>, RegExp]> = [
    [{ policyId: '' }, /binary_policy_id_required/], [{ allowedKinds: [] }, /binary_policy_kinds_invalid/],
    [{ allowedKinds: ['PDF', 'PDF'] }, /binary_policy_kinds_invalid/], [{ maximumBytes: 0 }, /binary_policy_maximum_bytes_invalid/],
    [{ chunkBytes: 255 }, /binary_policy_chunk_bytes_invalid/], [{ chunkBytes: 1024 * 1024 + 1 }, /binary_policy_chunk_bytes_invalid/],
    [{ maximumArchiveEntries: 0 }, /binary_policy_archive_entries_invalid/], [{ maximumCompressionRatio: 0 }, /binary_policy_compression_ratio_invalid/],
    [{ maximumEntropy: -1 }, /binary_policy_entropy_invalid/], [{ maximumEntropy: 9 }, /binary_policy_entropy_invalid/],
  ];
  for (const [override, reason] of invalidPolicies) assert.throws(() => inspectBinaryArtifactV32_14('x.bin', Buffer.from('x'), { ...policy, ...override }), reason);
  assert.throws(() => inspectBinaryArtifactV32_14('', Buffer.from('x'), policy), /binary_artifact_name_invalid/);
  assert.throws(() => inspectBinaryArtifactV32_14('a/b', Buffer.from('x'), policy), /binary_artifact_name_invalid/);
  assert.throws(() => inspectBinaryArtifactV32_14('bad\0name', Buffer.from('x'), policy), /binary_artifact_name_invalid/);
  assert.throws(() => inspectBinaryArtifactV32_14('x', 'not-a-buffer' as unknown as Buffer, policy), /binary_bytes_required/);

  const small = inspectBinaryArtifactV32_14('small.pdf', Buffer.from('%PDF-1.7\n%%EOF'), { ...policy, chunkBytes: 256 });
  const large = inspectBinaryArtifactV32_14('large.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(700, 1), Buffer.from('%%EOF')]), { ...policy, chunkBytes: 256 });
  const added = compareBinaryArtifactsV32_14(small, large);
  const removed = compareBinaryArtifactsV32_14(large, small);
  const equal = compareBinaryArtifactsV32_14(small, small);
  assert.ok(added.addedChunks.length > 0);
  assert.ok(removed.removedChunks.length > 0);
  assert.equal(equal.equal, true);
  assert.equal(equal.matchingChunks, small.chunks.length);

  const badSchema = { ...small, schemaVersion: '32.13' } as unknown as ProofCarryingBinaryManifestV32_14;
  assert.throws(() => compareBinaryArtifactsV32_14(badSchema, small), /binary_manifest_invalid/);
  assert.throws(() => compareBinaryArtifactsV32_14({ ...small, merkleRoot: 'BAD' }, small), /binary_manifest_invalid/);
  assert.throws(() => compareBinaryArtifactsV32_14({ ...small, chunks: [{ ...small.chunks[0]!, sha256: 'BAD' }] }, small), /binary_manifest_chunks_invalid/);
});

test('frontier execution covers standard, high and diverse planning plus strict task/context validation', () => {
  const standard = compileFrontierExecutionPlanV32_14(task());
  assert.equal(standard.reasoningEffort, 'standard');
  assert.equal(standard.subagentMode, 'single');
  assert.equal(standard.assignments.every((item) => item.mayShareImplementation), true);
  assert.equal(standard.stages.includes('binary-intake-and-structure-proof'), false);

  const high = compileFrontierExecutionPlanV32_14(task({ complexity: 0.5 }));
  assert.equal(high.reasoningEffort, 'high');
  const diverse = compileFrontierExecutionPlanV32_14(task({ requiredProofClasses: ['DIFFERENTIAL'] }));
  assert.equal(diverse.subagentMode, 'diverse-team');
  assert.equal(diverse.assignments.find((item) => item.role === 'ADVERSARY')?.mayShareImplementation, false);
  const formal = compileFrontierExecutionPlanV32_14(task({ blastRadius: 0.8 }));
  assert.ok(formal.proofObligations.some((item) => item.proofClasses.includes('FORMAL')));

  const invalidTasks: Array<[Partial<FrontierTaskV32_14>, RegExp]> = [
    [{ taskId: '' }, /frontier_task_identity_invalid/], [{ objective: '' }, /frontier_task_identity_invalid/],
    [{ complexity: -1 }, /frontier_task_complexity_invalid/], [{ uncertainty: Number.NaN }, /frontier_task_uncertainty_invalid/],
    [{ blastRadius: 2 }, /frontier_task_blastRadius_invalid/], [{ novelty: -0.1 }, /frontier_task_novelty_invalid/],
    [{ expectedDurationMinutes: 0 }, /frontier_task_expectedDurationMinutes_invalid/], [{ maximumContextChars: 0 }, /frontier_task_maximumContextChars_invalid/],
    [{ maximumOutputChars: 0 }, /frontier_task_maximumOutputChars_invalid/], [{ maximumCostMicros: 0 }, /frontier_task_maximumCostMicros_invalid/],
    [{ requiredProofClasses: [] }, /frontier_task_proof_classes_invalid/], [{ requiredProofClasses: ['STATIC', 'STATIC'] }, /frontier_task_proof_classes_invalid/],
  ];
  for (const [override, reason] of invalidTasks) assert.throws(() => compileFrontierExecutionPlanV32_14(task(override)), reason);

  const invalidContexts: Array<[FrontierContextCandidateV32_14, RegExp]> = [
    [{ ...requiredContexts[0]!, contextId: '' }, /frontier_context_invalid/], [{ ...requiredContexts[0]!, content: '' }, /frontier_context_invalid/],
    [{ ...requiredContexts[0]!, relevance: -1 }, /frontier_context_relevance_invalid/], [{ ...requiredContexts[0]!, novelty: 2 }, /frontier_context_novelty_invalid/],
    [{ ...requiredContexts[0]!, freshness: Number.NaN }, /frontier_context_freshness_invalid/], [{ ...requiredContexts[0]!, evidenceRefs: [''] }, /frontier_context_evidence_invalid/],
  ];
  for (const [candidate, reason] of invalidContexts) assert.throws(() => compileFrontierContextV32_14(task(), [candidate]), reason);
});

test('frontier context, claim and iteration edge branches stay fail closed', () => {
  const selection = compileFrontierContextV32_14(task({ maximumContextChars: 100 }), [
    ...requiredContexts, context('z', 'TEST', 'z'.repeat(90), 'TRUSTED', 1), context('a', 'TEST', 'a', 'UNTRUSTED', 1),
    context('tie-b', 'TEST', 'tie', 'TRUSTED', 0.1), context('tie-a', 'TEST', 'tie-2', 'TRUSTED', 0.1),
  ]);
  assert.ok(selection.dropped.some((item) => item.reason === 'context-budget'));
  assert.throws(() => compileFrontierContextV32_14(task(), requiredContexts.filter((item) => item.class !== 'PRODUCT')), /frontier_context_required_class_missing:PRODUCT/);

  assert.throws(() => adjudicateFrontierClaimV32_14({ claimId: '', statement: 'x', evidence: [] }), /frontier_claim_invalid/);
  assert.throws(() => adjudicateFrontierClaimV32_14({ claimId: 'x', statement: '', evidence: [] }), /frontier_claim_invalid/);
  assert.throws(() => adjudicateFrontierClaimV32_14({ claimId: 'x', statement: 'x', evidence: [{ evidenceId: '', proofClass: 'STATIC', independentOracle: 'o', passed: true, artifactDigest: digest }] }), /frontier_claim_evidence_invalid/);
  assert.throws(() => adjudicateFrontierClaimV32_14({ claimId: 'x', statement: 'x', evidence: [{ evidenceId: 'e', proofClass: 'STATIC', independentOracle: '', passed: true, artifactDigest: digest }] }), /frontier_claim_evidence_invalid/);
  assert.throws(() => adjudicateFrontierClaimV32_14({ claimId: 'x', statement: 'x', evidence: [{ evidenceId: 'e', proofClass: 'STATIC', independentOracle: 'o', passed: true, artifactDigest: 'bad' }] }), /frontier_claim_evidence_invalid/);

  const base = { iteration: 0, unresolvedClaims: 0, mutationSurvivors: 0, differentialDisagreements: 0, invariantViolations: 0, failingTests: 0, coverageBranchPercent: 96, coverageBranchThreshold: 96, externalBlockers: 0 };
  assert.throws(() => chooseFrontierNextActionV32_14({ ...base, iteration: -1 }), /frontier_iteration_invalid/);
  for (const key of ['unresolvedClaims', 'mutationSurvivors', 'differentialDisagreements', 'invariantViolations', 'failingTests', 'externalBlockers'] as const) {
    assert.throws(() => chooseFrontierNextActionV32_14({ ...base, [key]: -1 }), new RegExp(`frontier_state_invalid:${key}`));
  }
  assert.throws(() => chooseFrontierNextActionV32_14({ ...base, coverageBranchPercent: Number.NaN }), /frontier_coverage_invalid/);
  assert.throws(() => chooseFrontierNextActionV32_14({ ...base, coverageBranchThreshold: Number.POSITIVE_INFINITY }), /frontier_coverage_invalid/);
});

test('comparative assurance covers missing, ranking, failure, validation and all status branches', () => {
  const req = requirement();
  const missing = evaluateFrontierSystemV32_14({ systemId: 'missing', profileVersion: '1', evidence: [] }, [req]);
  assert.equal(missing.dimensions[0]?.status, 'UNPROVEN');
  assert.equal(missing.status, 'NOT_FRONTIER');

  const ranked = evaluateFrontierSystemV32_14({ systemId: 'ranked', profileVersion: '1', evidence: [
    capability('CODING_AND_REPAIR', 1, 'OFFICIAL_PROVIDER_CLAIM', 'z'),
    capability('CODING_AND_REPAIR', 0.9, 'OBSERVED_CURRENT_EXECUTION', 'b'),
    capability('CODING_AND_REPAIR', 0.9, 'OBSERVED_CURRENT_EXECUTION', 'a'),
  ] }, [req]);
  assert.equal(ranked.dimensions[0]?.evidenceRef, 'a');
  assert.equal(ranked.status, 'FRONTIER_CANDIDATE');

  const failed = evaluateFrontierSystemV32_14({ systemId: 'failed', profileVersion: '1', evidence: [capability('CODING_AND_REPAIR', 0.2, 'OBSERVED_CURRENT_EXECUTION')] }, [req]);
  assert.equal(failed.dimensions[0]?.status, 'FAIL');
  assert.equal(failed.status, 'NOT_FRONTIER');

  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '', evidence: [] }, [req]), /frontier_profile_identity_invalid/);
  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '1', evidence: [capability('CODING_AND_REPAIR', Number.NaN, 'OBSERVED_CURRENT_EXECUTION')] }, [req]), /frontier_profile_score_invalid/);
  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '1', evidence: [{ ...capability('CODING_AND_REPAIR', 1, 'OBSERVED_CURRENT_EXECUTION'), evidenceRef: '' }] }, [req]), /frontier_profile_evidence_invalid/);
  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '1', evidence: [{ ...capability('CODING_AND_REPAIR', 1, 'OBSERVED_CURRENT_EXECUTION'), artifactDigest: 'BAD' }] }, [req]), /frontier_profile_evidence_invalid/);
  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '1', evidence: [] }, [req, req]), /frontier_requirements_invalid/);
  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '1', evidence: [] }, [requirement({ minimumScore: 0 })]), /frontier_requirement_score_invalid/);
  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '1', evidence: [] }, [requirement({ weight: 0 })]), /frontier_requirement_weight_invalid/);
  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '1', evidence: [] }, [requirement({ requiredEvidenceClasses: [] })]), /frontier_requirement_evidence_classes_invalid/);
  assert.throws(() => evaluateFrontierSystemV32_14({ systemId: 'x', profileVersion: '1', evidence: [] }, [requirement({ requiredEvidenceClasses: ['STATIC', 'STATIC'] })]), /frontier_requirement_evidence_classes_invalid/);
});
