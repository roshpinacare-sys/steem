import { sha256 } from '../contracts/crypto.js';
export interface ReproducibilityCapsule { readonly sourceDigest: string; readonly artifactDigest: string; readonly seed: string; readonly clockMode: 'fixed' | 'monotonic'; readonly timezone: string; readonly locale: string; readonly runtimeVersions: Readonly<Record<string,string>>; readonly environmentAllowlist: readonly string[]; }
export interface ReproducibilityReport { readonly status: 'PASS' | 'BLOCK'; readonly mismatches: readonly string[]; readonly capsuleDigest: string; readonly reportDigest: string; }
export function compareReproducibilityCapsules(expected: ReproducibilityCapsule, actual: ReproducibilityCapsule): ReproducibilityReport {
  for (const capsule of [expected, actual]) if (!/^[0-9a-f]{64}$/.test(capsule.sourceDigest) || !/^[0-9a-f]{64}$/.test(capsule.artifactDigest) || capsule.seed.trim() === '' || capsule.timezone.trim() === '' || capsule.locale.trim() === '') throw new Error('reproducibility_capsule_invalid');
  const mismatches: string[] = [];
  for (const key of ['sourceDigest','artifactDigest','seed','clockMode','timezone','locale'] as const) if (expected[key] !== actual[key]) mismatches.push(`field_mismatch:${key}`);
  const runtimeKeys = [...new Set([...Object.keys(expected.runtimeVersions), ...Object.keys(actual.runtimeVersions)])].sort();
  for (const key of runtimeKeys) if (expected.runtimeVersions[key] !== actual.runtimeVersions[key]) mismatches.push(`runtime_mismatch:${key}`);
  if ([...expected.environmentAllowlist].sort().join('\u0000') !== [...actual.environmentAllowlist].sort().join('\u0000')) mismatches.push('environment_allowlist_mismatch');
  const capsuleDigest = sha256(actual); const material = { status: mismatches.length === 0 ? 'PASS' as const : 'BLOCK' as const, mismatches, capsuleDigest };
  return { ...material, reportDigest: sha256(material) };
}
