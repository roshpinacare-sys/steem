import { sha256 } from '../contracts/crypto.js';

export interface ModuleComplexityObservation {
  readonly path: string;
  readonly sourceLines: number;
  readonly importCount: number;
  readonly exportedSymbolCount: number;
  readonly decisionPointCount: number;
  readonly maximumFunctionLines: number;
}
export interface ComplexityBudget {
  readonly maximumSourceLines: number;
  readonly maximumImports: number;
  readonly maximumExportedSymbols: number;
  readonly maximumDecisionPoints: number;
  readonly maximumFunctionLines: number;
  readonly maximumWarningRatePercent: number;
}
export interface ComplexityBudgetReport {
  readonly status: 'PASS' | 'WARN' | 'BLOCK';
  readonly totals: { readonly modules: number; readonly warnings: number; readonly blocks: number; readonly warningRatePercent: number };
  readonly findings: readonly { readonly path: string; readonly severity: 'WARNING' | 'BLOCK'; readonly metric: string; readonly observed: number; readonly maximum: number }[];
  readonly highestRiskModules: readonly { readonly path: string; readonly debtPoints: number }[];
  readonly reportDigest: string;
}

export function evaluateComplexityBudget(modules: readonly ModuleComplexityObservation[], budget: ComplexityBudget): ComplexityBudgetReport {
  validateBudget(budget);
  const paths = new Set<string>(); const findings: { path: string; severity: 'WARNING' | 'BLOCK'; metric: string; observed: number; maximum: number }[] = [];
  const risks: { path: string; debtPoints: number }[] = [];
  for (const module of modules) {
    if (module.path.trim() === '' || paths.has(module.path)) throw new Error('complexity_module_identity_invalid');
    paths.add(module.path);
    const values = [module.sourceLines, module.importCount, module.exportedSymbolCount, module.decisionPointCount, module.maximumFunctionLines];
    if (!values.every((value) => Number.isInteger(value) && value >= 0)) throw new Error('complexity_observation_invalid');
    const checks = [
      ['sourceLines', module.sourceLines, budget.maximumSourceLines],
      ['importCount', module.importCount, budget.maximumImports],
      ['exportedSymbolCount', module.exportedSymbolCount, budget.maximumExportedSymbols],
      ['decisionPointCount', module.decisionPointCount, budget.maximumDecisionPoints],
      ['maximumFunctionLines', module.maximumFunctionLines, budget.maximumFunctionLines],
    ] as const;
    let debtPoints = 0;
    for (const [metric, observed, maximum] of checks) {
      if (observed <= maximum) continue;
      const ratio = observed / maximum;
      const severity = ratio > 1.5 ? 'BLOCK' as const : 'WARNING' as const;
      findings.push({ path: module.path, severity, metric, observed, maximum });
      debtPoints += Math.ceil((ratio - 1) * 100) * (severity === 'BLOCK' ? 2 : 1);
    }
    risks.push({ path: module.path, debtPoints });
  }
  const warnedModules = new Set(findings.map((item) => item.path));
  const warningRatePercent = modules.length === 0 ? 0 : round((warnedModules.size / modules.length) * 100);
  const blocks = findings.filter((item) => item.severity === 'BLOCK').length;
  const warnings = findings.filter((item) => item.severity === 'WARNING').length;
  const status: ComplexityBudgetReport['status'] = blocks > 0 || warningRatePercent > budget.maximumWarningRatePercent ? 'BLOCK' : warnings > 0 ? 'WARN' : 'PASS';
  const totals = { modules: modules.length, warnings, blocks, warningRatePercent };
  const highestRiskModules = risks.filter((item) => item.debtPoints > 0).sort((a, b) => b.debtPoints - a.debtPoints || a.path.localeCompare(b.path)).slice(0, 10);
  const material = { status, totals, findings: findings.sort((a, b) => a.path.localeCompare(b.path) || a.metric.localeCompare(b.metric)), highestRiskModules };
  return { ...material, reportDigest: sha256(material) };
}
function validateBudget(budget: ComplexityBudget): void {
  const values = [budget.maximumSourceLines, budget.maximumImports, budget.maximumExportedSymbols, budget.maximumDecisionPoints, budget.maximumFunctionLines];
  if (!values.every((value) => Number.isInteger(value) && value > 0) || !Number.isFinite(budget.maximumWarningRatePercent) || budget.maximumWarningRatePercent < 0 || budget.maximumWarningRatePercent > 100) throw new Error('complexity_budget_invalid');
}
function round(value: number): number { return Number(value.toFixed(2)); }
