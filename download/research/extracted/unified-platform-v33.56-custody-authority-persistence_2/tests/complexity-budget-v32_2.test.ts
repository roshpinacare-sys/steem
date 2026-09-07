import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateComplexityBudget, type ComplexityBudget, type ModuleComplexityObservation } from '../src/validation/complexity-budget.js';
const budget: ComplexityBudget = { maximumSourceLines: 400, maximumImports: 15, maximumExportedSymbols: 20, maximumDecisionPoints: 80, maximumFunctionLines: 100, maximumWarningRatePercent: 20 };
function module(path: string, overrides: Partial<ModuleComplexityObservation> = {}): ModuleComplexityObservation { return { path, sourceLines: 200, importCount: 5, exportedSymbolCount: 4, decisionPointCount: 20, maximumFunctionLines: 40, ...overrides }; }

test('complexity budget passes bounded modules', () => { const report = evaluateComplexityBudget([module('a.ts'), module('b.ts')], budget); assert.equal(report.status, 'PASS'); assert.equal(report.totals.warningRatePercent, 0); });
test('moderate excess is warning and creates debt ranking', () => { const report = evaluateComplexityBudget([module('a.ts', { sourceLines: 500 }), module('b.ts')], { ...budget, maximumWarningRatePercent: 60 }); assert.equal(report.status, 'WARN'); assert.equal(report.highestRiskModules[0]!.path, 'a.ts'); });
test('large excess or broad warning rate blocks', () => { const report = evaluateComplexityBudget([module('a.ts', { maximumFunctionLines: 200 }), module('b.ts', { importCount: 20 })], budget); assert.equal(report.status, 'BLOCK'); assert.ok(report.totals.blocks > 0); });
test('complexity budget rejects duplicate paths and invalid metrics', () => { assert.throws(() => evaluateComplexityBudget([module('a'), module('a')], budget), /identity_invalid/); assert.throws(() => evaluateComplexityBudget([module('a', { sourceLines: -1 })], budget), /observation_invalid/); assert.throws(() => evaluateComplexityBudget([], { ...budget, maximumImports: 0 }), /budget_invalid/); });
