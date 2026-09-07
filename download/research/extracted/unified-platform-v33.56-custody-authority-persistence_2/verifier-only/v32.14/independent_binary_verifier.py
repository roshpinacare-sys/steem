#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, math, re, sys
from pathlib import Path

HEX64 = re.compile(r'^[0-9a-f]{64}$')

def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()

def detect_kind(data: bytes) -> str:
    if data.startswith(b'\x00asm'): return 'WASM'
    if data.startswith(b'\x7fELF'): return 'ELF'
    if data.startswith(b'MZ'): return 'PE'
    if len(data) >= 4 and int.from_bytes(data[:4], 'big') in (0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe,0xcafebabe,0xbebafeca): return 'MACH_O'
    if data.startswith(b'PK\x03\x04'): return 'ZIP'
    if data.startswith(b'%PDF-'): return 'PDF'
    if data.startswith(b'\x89PNG\r\n\x1a\n'): return 'PNG'
    if data.startswith(b'\xff\xd8\xff'): return 'JPEG'
    if data.startswith(b'\x1f\x8b'): return 'GZIP'
    if data.startswith(b'\xd9\xd9\xf7'): return 'CBOR'
    return 'UNKNOWN'

def chunk_digest(index: int, chunk: bytes) -> str:
    return sha256_bytes(f'upp-binary-chunk-v32.14:{index}:'.encode() + chunk)

def merkle_root(leaves: list[str]) -> str:
    if not leaves:
        raise ValueError('empty_artifact_forbidden')
    level = [bytes.fromhex(item) for item in leaves]
    while len(level) > 1:
        next_level: list[bytes] = []
        for index in range(0, len(level), 2):
            left = level[index]
            right = level[index + 1] if index + 1 < len(level) else left
            next_level.append(hashlib.sha256(b'upp-binary-merkle-node-v32.14:' + left + right).digest())
        level = next_level
    return level[0].hex()

def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result: raise ValueError(f'duplicate_json_key:{key}')
        result[key] = value
    return result

def verify(artifact: Path, manifest_path: Path) -> dict:
    data = artifact.read_bytes()
    manifest = json.loads(manifest_path.read_text(), object_pairs_hook=reject_duplicate_keys)
    reasons: list[str] = []
    if manifest.get('schemaVersion') != '32.14': reasons.append('schema_version_mismatch')
    if manifest.get('artifactName') != artifact.name: reasons.append('artifact_name_mismatch')
    if manifest.get('sizeBytes') != len(data): reasons.append('artifact_size_mismatch')
    content_digest = sha256_bytes(data)
    if manifest.get('contentDigest') != content_digest: reasons.append('content_digest_mismatch')
    kind = detect_kind(data)
    if manifest.get('detectedKind') != kind: reasons.append('detected_kind_mismatch')
    chunks = manifest.get('chunks')
    if not isinstance(chunks, list) or not chunks: reasons.append('chunks_invalid'); chunks = []
    leaves: list[str] = []
    expected_offset = 0
    chunk_bytes = None
    for index, row in enumerate(chunks):
        if not isinstance(row, dict): reasons.append(f'chunk_shape:{index}'); continue
        size = row.get('bytes')
        offset = row.get('offset')
        if row.get('index') != index: reasons.append(f'chunk_index:{index}')
        if offset != expected_offset: reasons.append(f'chunk_offset:{index}')
        if not isinstance(size, int) or size < 1: reasons.append(f'chunk_size:{index}'); continue
        if chunk_bytes is None and index < len(chunks)-1: chunk_bytes = size
        if index < len(chunks)-1 and chunk_bytes is not None and size != chunk_bytes: reasons.append(f'chunk_width:{index}')
        chunk = data[offset:offset+size] if isinstance(offset, int) else b''
        digest = chunk_digest(index, chunk)
        leaves.append(digest)
        if row.get('sha256') != digest: reasons.append(f'chunk_digest:{index}')
        expected_offset += size
    if expected_offset != len(data): reasons.append('chunk_coverage_mismatch')
    if leaves:
        root = merkle_root(leaves)
        if manifest.get('merkleRoot') != root: reasons.append('merkle_root_mismatch')
    for field in ('contentDigest','policyDigest','merkleRoot','structuralDigest'):
        if not isinstance(manifest.get(field), str) or not HEX64.fullmatch(manifest[field]): reasons.append(f'digest_shape:{field}')
    verdict = 'VERIFIED' if not reasons else 'REJECTED'
    material = {'verdict': verdict, 'artifactDigest': content_digest, 'detectedKind': kind, 'reasons': sorted(set(reasons))}
    material['verificationDigest'] = hashlib.sha256(json.dumps(material, sort_keys=True, separators=(',',':')).encode()).hexdigest()
    return material

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('artifact')
    parser.add_argument('manifest')
    args = parser.parse_args()
    try:
        result = verify(Path(args.artifact), Path(args.manifest))
    except Exception as exc:
        result = {'verdict':'REJECTED','reasons':[f'verifier_error:{type(exc).__name__}:{exc}']}
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get('verdict') == 'VERIFIED' else 1

if __name__ == '__main__':
    raise SystemExit(main())
