#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
E = ROOT / 'release-evidence/v33.24'
errors: list[str] = []

def load(rel: str):
    return json.loads((ROOT / rel).read_text())

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def phase(name: str) -> None:
    print(json.dumps({'phase': name}), flush=True)

required = [
    'src/app/external-malware-airgap-v33_24.ts',
    'tests/external-malware-airgap-v33_24.test.ts',
    'scripts/external-malware-scan-worker-v33_24.mjs',
    'scripts/external-malware-airgap-proof-v33_24.mjs',
    'scripts/verify-external-malware-airgap-v33_24.mjs',
    'scripts/run-full-regression-v33_24.py',
    'scripts/run-direct-v33-regression-v33_24.py',
    'scripts/validate-v33_24.py',
    'docs/V33_24_EXTERNAL_MALWARE_SCANNER_AND_AIR_GAPPED_TRANSFER.md',
    'CLAUDE_HANDOFF_v33_24.md',
    'external-qualification/v33.24/malware-airgap/README.md',
    'external-qualification/v33.24/malware-airgap/RUNBOOK.md',
    'external-qualification/v33.24/malware-airgap/scanner-policy.json',
    'external-qualification/v33.24/malware-airgap/transfer-policy.json',
    'external-qualification/v33.24/malware-airgap/observation.template.json',
    'external-qualification/v33.24/malware-airgap/scripts/probe-scanners.sh',
    'external-qualification/v33.24/malware-airgap/scripts/hash-media.sh',
    'external-qualification/v33.24/malware-airgap/scripts/verify-readonly.sh',
    'external-qualification/v33.24/malware-airgap/scripts/verify-package.sh',
    'release-evidence/v33.24/V33_24_MALWARE_TOOL_PROBE.json',
    'release-evidence/v33.24/V33_24_SIGNATURE_FEED.json',
    'release-evidence/v33.24/V33_24_CLEAN_SCAN_RECEIPT.json',
    'release-evidence/v33.24/V33_24_REJECTED_SCAN_RECEIPT.json',
    'release-evidence/v33.24/V33_24_TRANSFER_MANIFEST.json',
    'release-evidence/v33.24/V33_24_IMPORT_RECEIPT.json',
    'release-evidence/v33.24/V33_24_SYNTHETIC_OBSERVATIONS.json',
    'release-evidence/v33.24/V33_24_EXTERNAL_QUALIFICATION_VERDICT.json',
    'release-evidence/v33.24/V33_24_MALWARE_AIRGAP_TRACE.json',
    'release-evidence/v33.24/V33_24_MALWARE_AIRGAP_PROOF.json',
    'release-evidence/v33.24/V33_24_EXTERNAL_OPERATOR_KIT_MANIFEST.json',
    'release-evidence/v33.24/V33_24_PROOF_PUBLIC_KEYS.json',
    'release-evidence/v33.24/V33_24_FULL_TEST_RESULTS.json',
    'release-evidence/v33.24/V33_24_FULL_TEST_META.json',
    'release-evidence/v33.24/V33_24_FULL_TEST_STDOUT.tap',
    'release-evidence/v33.24/V33_24_FULL_TEST_STDERR.log',
    'release-evidence/v33.24/V33_24_FULL_TEST_EXIT.txt',
    'release-evidence/v33.24/V33_24_DIRECT_V33_RESULTS.json',
    'release-evidence/v33.24/V33_24_REPOSITORY_TRUTH_MAP.json',
    'release-evidence/v33.24/V33_24_ARCHITECTURE_INTEGRITY.json',
    'release-evidence/v33.24/V33_24_EXECUTION_LEDGER.md',
    'release-evidence/v33.24/V33_24_RELEASE_MANIFEST.json',
]
for rel in required:
    if not (ROOT / rel).is_file():
        errors.append('missing:' + rel)
if errors:
    print(json.dumps({'version': '33.24', 'status': 'failed', 'errors': errors}, indent=2))
    sys.exit(1)

phase('load')
probe = load('release-evidence/v33.24/V33_24_MALWARE_TOOL_PROBE.json')
feed = load('release-evidence/v33.24/V33_24_SIGNATURE_FEED.json')
clean = load('release-evidence/v33.24/V33_24_CLEAN_SCAN_RECEIPT.json')
rejected = load('release-evidence/v33.24/V33_24_REJECTED_SCAN_RECEIPT.json')
transfer = load('release-evidence/v33.24/V33_24_TRANSFER_MANIFEST.json')
imp = load('release-evidence/v33.24/V33_24_IMPORT_RECEIPT.json')
observations = load('release-evidence/v33.24/V33_24_SYNTHETIC_OBSERVATIONS.json')
verdict = load('release-evidence/v33.24/V33_24_EXTERNAL_QUALIFICATION_VERDICT.json')
trace = load('release-evidence/v33.24/V33_24_MALWARE_AIRGAP_TRACE.json')
proof = load('release-evidence/v33.24/V33_24_MALWARE_AIRGAP_PROOF.json')
kit = load('release-evidence/v33.24/V33_24_EXTERNAL_OPERATOR_KIT_MANIFEST.json')
full = load('release-evidence/v33.24/V33_24_FULL_TEST_RESULTS.json')
meta = load('release-evidence/v33.24/V33_24_FULL_TEST_META.json')
direct = load('release-evidence/v33.24/V33_24_DIRECT_V33_RESULTS.json')
truth = load('release-evidence/v33.24/V33_24_REPOSITORY_TRUTH_MAP.json')
arch = load('release-evidence/v33.24/V33_24_ARCHITECTURE_INTEGRITY.json')
manifest = load('release-evidence/v33.24/V33_24_RELEASE_MANIFEST.json')

phase('boundaries')
p = proof.get('payload', {})
expected = {
    'status': 'EXTERNAL_MALWARE_AND_AIRGAP_REFERENCE_PROVEN_LOCALLY',
    'evidenceClass': 'LOCAL_SEPARATE_PROCESS_SCANNER_AND_DIRECTORY_MEDIA_REFERENCE',
    'focusedTestsExpected': 31,
    'cleanScanPassed': True,
    'rejectedScanBlocked': True,
    'separateScannerProcessVerified': True,
    'referenceFeedSigned': True,
    'externalScannerQualified': False,
    'transferClass': 'LOCAL_DIRECTORY_MEDIA_REFERENCE',
    'sourceReadOnlyIntent': True,
    'sourceUnmodified': True,
    'importEligibleForOfflineVerification': True,
    'importEligibleForExternalQualification': False,
    'syntheticObservations': 2,
    'syntheticObservationsAccepted': 0,
    'qualificationStatus': 'EXTERNAL_MALWARE_AIR_GAP_QUALIFICATION_REQUIRED',
    'externalLiveObservations': 0,
    'removableMediaProvisioned': False,
    'airGapProven': False,
    'operatorKitFileCount': 9,
    'productionAuthority': 'NONE',
    'externalEffectsExecuted': 0,
    'productionPromotion': 'blocked',
}
for key, value in expected.items():
    if p.get(key) != value:
        errors.append('proof:' + key)
if p.get('toolProbe') != {
    'clamscan': 'UNAVAILABLE_FAIL_CLOSED',
    'freshclam': 'UNAVAILABLE_FAIL_CLOSED',
    'yara': 'UNAVAILABLE_FAIL_CLOSED',
    'yarac': 'UNAVAILABLE_FAIL_CLOSED',
}:
    errors.append('proof:toolProbe')

for tool in ['clamscan', 'freshclam', 'yara', 'yarac']:
    if probe.get(tool) != 'UNAVAILABLE_FAIL_CLOSED':
        errors.append('tool_probe:' + tool)
if probe.get('externalScannerQualified') is not False or probe.get('productionAuthority') != 'NONE' or probe.get('externalEffectsExecuted') != 0:
    errors.append('tool_probe_boundary_invalid')

fp = feed.get('payload', {})
if fp.get('sourceClass') != 'LOCAL_REFERENCE_FEED' or fp.get('externalQualificationEligible') is not False or fp.get('productionAuthority') != 'NONE' or fp.get('externalEffectsExecuted') != 0 or len(fp.get('rules', [])) < 6:
    errors.append('signature_feed_invalid')
rule_ids = {r.get('ruleId') for r in fp.get('rules', [])}
if not {'EICAR_TEST_FILE', 'ELF_EXECUTABLE_MAGIC', 'PE_EXECUTABLE_MAGIC', 'PRIVATE_KEY_MATERIAL', 'OPENSSH_PRIVATE_KEY', 'AWS_ACCESS_KEY'}.issubset(rule_ids):
    errors.append('signature_feed_rules_missing')

cp = clean.get('payload', {})
rp = rejected.get('payload', {})
if cp.get('status') != 'PASSED' or cp.get('findingCount') != 0 or cp.get('scannerClass') != 'LOCAL_SEPARATE_PROCESS_REFERENCE' or cp.get('separateProcessVerified') is not True or cp.get('scannerProcessPid') == cp.get('parentProcessPid') or cp.get('externalMalwareQualificationEligible') is not False or cp.get('productionAuthority') != 'NONE' or cp.get('externalEffectsExecuted') != 0:
    errors.append('clean_scan_invalid')
if rp.get('status') != 'REJECTED' or rp.get('findingCount', 0) < 1 or rp.get('scannerClass') != 'LOCAL_SEPARATE_PROCESS_REFERENCE' or rp.get('externalMalwareQualificationEligible') is not False or rp.get('productionAuthority') != 'NONE' or rp.get('externalEffectsExecuted') != 0:
    errors.append('rejected_scan_invalid')
if not any('EICAR_TEST_FILE' in x.get('matchedRuleIds', []) for x in rp.get('artifactResults', [])):
    errors.append('eicar_not_rejected')
if cp.get('signatureFeedDigest') != fp.get('feedDigest') or rp.get('signatureFeedDigest') != fp.get('feedDigest'):
    errors.append('scan_feed_binding_invalid')

tr = transfer.get('payload', {})
ip = imp.get('payload', {})
if tr.get('transferClass') != 'LOCAL_DIRECTORY_MEDIA_REFERENCE' or tr.get('sourceReadOnlyIntent') is not True or tr.get('oneWayImportRequired') is not True or tr.get('externalQualificationEligible') is not False or tr.get('productionAuthority') != 'NONE' or tr.get('externalEffectsExecuted') != 0 or len(tr.get('entries', [])) != 3:
    errors.append('transfer_manifest_invalid')
if any(x.get('mode') != '0440' for x in tr.get('entries', [])):
    errors.append('transfer_modes_invalid')
if ip.get('importClass') != 'LOCAL_DIRECTORY_MEDIA_REFERENCE' or ip.get('sourceUnmodified') is not True or ip.get('sourceTreeDigestBefore') != ip.get('sourceTreeDigestAfter') or ip.get('importedEntryCount') != 4 or ip.get('destinationObjectMode') != '0600' or ip.get('eligibleForOfflineVerification') is not True or ip.get('eligibleForExternalQualification') is not False or ip.get('productionAuthority') != 'NONE' or ip.get('externalEffectsExecuted') != 0:
    errors.append('import_receipt_invalid')
if ip.get('packageDigest') != tr.get('packageDigest') or ip.get('scanReceiptDigest') != tr.get('scanReceiptDigest'):
    errors.append('transfer_import_binding_invalid')

tp = trace.get('payload', {})
if tp.get('evidenceClass') != 'LOCAL_SEPARATE_PROCESS_SCANNER_AND_DIRECTORY_MEDIA_TRACE' or tp.get('cleanScanStatus') != 'PASSED' or tp.get('rejectedScanStatus') != 'REJECTED' or tp.get('rejectedFindingCount', 0) < 1 or tp.get('separateProcessVerified') is not True or tp.get('transferClass') != 'LOCAL_DIRECTORY_MEDIA_REFERENCE' or tp.get('importClass') != 'LOCAL_DIRECTORY_MEDIA_REFERENCE' or tp.get('sourceUnmodified') is not True or tp.get('externalScannerExecuted') is not False or tp.get('removableMediaExecuted') is not False or tp.get('multiHostExecuted') is not False or tp.get('productionAuthority') != 'NONE' or tp.get('externalEffectsExecuted') != 0:
    errors.append('trace_invalid')
if tp.get('sourceNames') != tp.get('destinationNames') or set(tp.get('sourceModes', {}).values()) != {'0440'} or set(tp.get('destinationModes', {}).values()) != {'0600'}:
    errors.append('trace_media_modes_invalid')

if len(observations) != 2:
    errors.append('observation_count_invalid')
for obs in observations:
    op = obs.get('payload', {})
    if op.get('evidenceClass') != 'SYNTHETIC_CONTRACT_TEST' or op.get('productionAuthority') != 'NONE' or op.get('externalEffectsExecuted') != 0:
        errors.append('synthetic_observation_boundary_invalid')
vp = verdict.get('payload', {})
if vp.get('status') != 'EXTERNAL_MALWARE_AIR_GAP_QUALIFICATION_REQUIRED' or vp.get('acceptedObservationCount') != 0 or vp.get('syntheticObservationCount') != 2 or vp.get('uniqueHostCount') != 0 or vp.get('uniqueOperatorCount') != 0 or vp.get('requiredExternalScannerExecuted') is not False or vp.get('requiredRemovableMediaVerified') is not False or vp.get('eligibleForProductionPromotion') is not False or vp.get('productionAuthority') != 'NONE' or vp.get('externalEffectsExecuted') != 0:
    errors.append('qualification_verdict_invalid')

phase('operator-kit')
kit_files = kit.get('files', [])
if len(kit_files) != 9 or kit.get('credentialsEmbedded') is not False or kit.get('privateKeysEmbedded') is not False or kit.get('externalScannerBinariesEmbedded') is not False or kit.get('signatureDatabasesEmbedded') is not False or kit.get('removableMediaProvisioned') is not False or kit.get('liveExternalEvidenceIncluded') is not False or kit.get('productionAuthority') != 'NONE' or kit.get('externalEffectsExecuted') != 0:
    errors.append('operator_kit_invalid')
for entry in kit_files:
    path = ROOT / str(entry.get('path', ''))
    if not path.is_file() or path.stat().st_size != entry.get('sizeBytes') or sha(path) != entry.get('sha256'):
        errors.append('operator_kit_file_invalid:' + str(entry.get('path')))
secret_rx = re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?://[^\s<]+|PGPASSWORD\s*=\s*[^\s#]+|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}', re.I)
for entry in kit_files:
    path = ROOT / str(entry.get('path', ''))
    if secret_rx.search(path.read_text(errors='ignore')):
        errors.append('secret_material:' + str(entry.get('path')))

phase('regression')
ft = full.get('totals', {})
if full.get('version') != '33.24' or full.get('status') != 'passed' or (ft.get('testFiles'), ft.get('tests'), ft.get('passed'), ft.get('failed')) != (209, 1632, 1632, 0) or full.get('runnerExitCode') != 0 or full.get('timedOut') is not False or full.get('retry') is not False or full.get('forceExitDisabled') is not True or full.get('sensitiveFileCount') != 14:
    errors.append('full_regression_invalid')
if 'fourteen stateful' not in full.get('testTopologyReason', ''):
    errors.append('full_topology_description_invalid')
if (E / 'V33_24_FULL_TEST_EXIT.txt').read_text().strip() != '0':
    errors.append('full_exit_invalid')
if meta.get('version') != '33.24' or meta.get('testFileCount') != 209 or meta.get('exitCode') != 0 or meta.get('timedOut') is not False or meta.get('retry') is not False or meta.get('forceExitDisabled') is not True or meta.get('topology') != full.get('topology'):
    errors.append('full_meta_invalid')
if sha(E / 'V33_24_FULL_TEST_STDOUT.tap') != full.get('stdoutSha256') or sha(E / 'V33_24_FULL_TEST_STDERR.log') != full.get('stderrSha256'):
    errors.append('full_output_hash_invalid')
dt = direct.get('totals', {})
if direct.get('version') != '33.24' or direct.get('status') != 'passed' or direct.get('independentProcessPerFile') is not True or direct.get('retry') is not False or direct.get('forceExit') is not False or (dt.get('testFiles'), dt.get('tests'), dt.get('passed'), dt.get('failed')) != (24, 465, 465, 0):
    errors.append('direct_v33_invalid')

inv = truth.get('inventory', {})
metrics = arch.get('metrics', {})
if truth.get('status') != 'passed' or truth.get('findings') or (inv.get('sourceModules'), inv.get('testFiles')) != (213, 209):
    errors.append('truth_invalid')
if arch.get('status') != 'PASS' or arch.get('findings') or (metrics.get('sourceCycleCount'), metrics.get('untestedSourceCount'), metrics.get('capabilityPathCount'), metrics.get('closedCapabilityPathCount')) != (0, 0, 143, 143):
    errors.append('architecture_invalid')

phase('verify-proof')
proc = subprocess.run(['node', 'scripts/verify-external-malware-airgap-v33_24.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=120)
if proc.returncode != 0:
    errors.append('proof_verifier_failed:' + (proc.stderr or proc.stdout)[-500:])
else:
    try:
        out = json.loads(proc.stdout)
        if out.get('status') != 'passed' or out.get('signaturesVerified', 0) < 12 or out.get('externalQualification') is not False or out.get('productionAuthority') != 'NONE':
            errors.append('proof_verifier_boundary_invalid')
    except Exception:
        errors.append('proof_verifier_output_invalid')

phase('regenerate')
truth_run = subprocess.run(['node', 'scripts/repository-truth-map-v32_18.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=180)
arch_run = subprocess.run(['node', 'scripts/architecture-validation-v32.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=180)
if truth_run.returncode != 0 or arch_run.returncode != 0:
    errors.append('regeneration_failed')
else:
    regenerated_truth = load('evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json')
    regenerated_arch = load('evidence/generated/V32_ARCHITECTURE_INTEGRITY.json')
    if regenerated_truth.get('inventory') != truth.get('inventory') or regenerated_truth.get('findings') != truth.get('findings'):
        errors.append('truth_regeneration_mismatch')
    if regenerated_arch.get('graphDigest') != arch.get('graphDigest') or regenerated_arch.get('metrics') != arch.get('metrics'):
        errors.append('architecture_regeneration_mismatch')

phase('manifest')
if not manifest.get('files'):
    errors.append('manifest_empty')
for entry in manifest.get('files', []):
    path = ROOT / str(entry.get('path', ''))
    if not path.is_file() or path.stat().st_size != entry.get('sizeBytes') or sha(path) != entry.get('sha256'):
        errors.append('manifest_file_invalid:' + str(entry.get('path')))
if manifest.get('version') != '33.24' or manifest.get('externalEffects') != 0 or manifest.get('productionPromotion') != 'blocked' or manifest.get('evidenceClass') != 'LOCAL_SEPARATE_PROCESS_SCANNER_AND_DIRECTORY_MEDIA_REFERENCE':
    errors.append('manifest_boundary_invalid')

result = {
    'version': '33.24',
    'status': 'passed' if not errors else 'failed',
    'evidenceClass': p.get('evidenceClass'),
    'gates': {
        'G0': 'passed',
        'G1': 'passed',
        'G2': 'in-progress-not-passed',
        'G3': 'in-progress-not-passed',
        'G4': 'in-progress-not-passed',
        'G5': 'in-progress-not-passed',
        'G6': 'in-progress-not-passed',
    },
    'malwareAirGap': {key: p.get(key) for key in expected},
    'toolProbe': {key: probe.get(key) for key in ['clamscan', 'freshclam', 'yara', 'yarac', 'externalScannerQualified']},
    'regression': ft,
    'directV33': dt,
    'truthMap': {
        'sourceModules': inv.get('sourceModules'),
        'testFiles': inv.get('testFiles'),
        'scripts': inv.get('scripts'),
        'findings': len(truth.get('findings', [])),
    },
    'architecture': {key: metrics.get(key) for key in ['sourceCycleCount', 'untestedSourceCount', 'capabilityPathCount', 'closedCapabilityPathCount']},
    'errors': errors,
    'productionPromotion': 'blocked',
}
E.mkdir(parents=True, exist_ok=True)
(E / 'V33_24_VALIDATION.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
sys.exit(0 if not errors else 1)
