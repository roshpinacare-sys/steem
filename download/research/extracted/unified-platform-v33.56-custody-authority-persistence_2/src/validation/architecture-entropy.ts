import { sha256 } from '../contracts/crypto.js';
export interface ArchitectureEntropyInput { readonly sourceModules: number; readonly dependencyEdges: number; readonly cycles: number; readonly layerViolations: number; readonly authorityImplementations: readonly { readonly authority: string; readonly implementationIds: readonly string[] }[]; readonly untestedModules: number; }
export interface ArchitectureEntropyReport { readonly status: 'PASS' | 'BLOCK'; readonly score: number; readonly metrics: { readonly edgeDensity: number; readonly duplicateAuthorities: number; readonly cycles: number; readonly layerViolations: number; readonly untestedModules: number }; readonly findings: readonly string[]; readonly reportDigest: string; }
export function evaluateArchitectureEntropy(input: ArchitectureEntropyInput): ArchitectureEntropyReport {
  if (!Number.isInteger(input.sourceModules) || input.sourceModules < 1 || !Number.isInteger(input.dependencyEdges) || input.dependencyEdges < 0) throw new Error('architecture_entropy_input_invalid');
  const duplicateAuthorities = input.authorityImplementations.filter((item) => item.authority.trim() !== '' && new Set(item.implementationIds).size > 1).length;
  const edgeDensity = Number((input.dependencyEdges / input.sourceModules).toFixed(2));
  const findings = [
    ...(input.cycles > 0 ? [`cycles:${input.cycles}`] : []),
    ...(input.layerViolations > 0 ? [`layer_violations:${input.layerViolations}`] : []),
    ...(input.untestedModules > 0 ? [`untested_modules:${input.untestedModules}`] : []),
    ...(duplicateAuthorities > 0 ? [`duplicate_authorities:${duplicateAuthorities}`] : []),
    ...(edgeDensity > 8 ? [`edge_density_high:${edgeDensity}`] : []),
  ];
  const score = Math.max(0, Number((100 - input.cycles * 20 - input.layerViolations * 10 - input.untestedModules * 5 - duplicateAuthorities * 15 - Math.max(0, edgeDensity - 6) * 2).toFixed(2)));
  const metrics = { edgeDensity, duplicateAuthorities, cycles: input.cycles, layerViolations: input.layerViolations, untestedModules: input.untestedModules };
  const material = { status: findings.some((item) => !item.startsWith('edge_density_high:')) ? 'BLOCK' as const : 'PASS' as const, score, metrics, findings };
  return { ...material, reportDigest: sha256(material) };
}
