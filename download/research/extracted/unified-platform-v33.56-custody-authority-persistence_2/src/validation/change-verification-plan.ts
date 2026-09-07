import { sha256 } from '../contracts/crypto.js';
export interface VerificationMapping { readonly sourcePattern: string; readonly capabilityIds: readonly string[]; readonly testRefs: readonly string[]; readonly critical: boolean; }
export interface ChangeVerificationInput { readonly changedFiles: readonly string[]; readonly mappings: readonly VerificationMapping[]; readonly fullSuiteRef: string; }
export interface ChangeVerificationPlanReport { readonly status: 'PASS' | 'BLOCK'; readonly metrics: { readonly changedFiles: number; readonly mappedFiles: number; readonly impactedCapabilities: number; readonly selectedTests: number; readonly fullSuiteRequired: boolean }; readonly unmappedFiles: readonly string[]; readonly impactedCapabilities: readonly string[]; readonly selectedTests: readonly string[]; readonly reportDigest: string; }
export function buildChangeVerificationPlan(input: ChangeVerificationInput): ChangeVerificationPlanReport {
  if (input.fullSuiteRef.trim() === '') throw new Error('verification_full_suite_required');
  const changedFiles = [...new Set(input.changedFiles)].sort();
  if (changedFiles.some((file) => file.trim() === '')) throw new Error('verification_changed_file_invalid');
  const matched = changedFiles.map((file) => ({ file, mappings: input.mappings.filter((mapping) => matches(file, mapping.sourcePattern)) }));
  const unmappedFiles = matched.filter((item) => item.mappings.length === 0).map((item) => item.file);
  const impactedCapabilities = [...new Set(matched.flatMap((item) => item.mappings.flatMap((mapping) => mapping.capabilityIds)))].sort();
  const selectedTests = [...new Set(matched.flatMap((item) => item.mappings.flatMap((mapping) => mapping.testRefs)))].sort();
  const fullSuiteRequired = matched.some((item) => item.mappings.some((mapping) => mapping.critical));
  if (fullSuiteRequired) selectedTests.push(input.fullSuiteRef);
  const metrics = { changedFiles: changedFiles.length, mappedFiles: changedFiles.length - unmappedFiles.length, impactedCapabilities: impactedCapabilities.length, selectedTests: new Set(selectedTests).size, fullSuiteRequired };
  const material = { status: unmappedFiles.length === 0 && selectedTests.length > 0 ? 'PASS' as const : 'BLOCK' as const, metrics, unmappedFiles, impactedCapabilities, selectedTests: [...new Set(selectedTests)].sort() };
  return { ...material, reportDigest: sha256(material) };
}
function matches(file: string, pattern: string): boolean { if (pattern.trim() === '') throw new Error('verification_pattern_invalid'); if (pattern.endsWith('/**')) return file.startsWith(pattern.slice(0,-3)); if (pattern.startsWith('*.')) return file.endsWith(pattern.slice(1)); return file === pattern || file.startsWith(`${pattern}/`); }
