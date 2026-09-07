import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { canonicalJson, KeyRegistry, sha256, signEnvelope, type SignedEnvelope, type SigningIdentity } from '../contracts/crypto.js';

export const AUTOMATION_TRIGGER_TYPES = ['TEST_FAILURE', 'INCIDENT_REPORTED', 'EVIDENCE_STALE', 'DEPENDENCY_BLOCKED', 'MANUAL_REVIEW'] as const;
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];
export const AUTOMATION_ACTION_KINDS = ['PREPARE_REVIEW', 'OPEN_OPERATIONAL_ACTION', 'PROPOSE_TESTS', 'PROPOSE_RECERTIFICATION', 'REFRESH_EVIDENCE'] as const;
export type AutomationActionKind = (typeof AUTOMATION_ACTION_KINDS)[number];
export type AutomationSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AutomationRuleCondition {
  readonly minimumSeverity?: AutomationSeverity;
  readonly subjectPrefix?: string;
  readonly attributeEquals?: Readonly<Record<string, string>>;
}
export interface AutomationActionTemplate {
  readonly kind: AutomationActionKind;
  readonly title: string;
  readonly owner: string;
  readonly payload?: Readonly<Record<string, string | number | boolean>>;
}
export interface GovernedAutomationRule {
  readonly ruleId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly triggerType: AutomationTriggerType;
  readonly condition: AutomationRuleCondition;
  readonly actions: readonly AutomationActionTemplate[];
  readonly maxActions: number;
  readonly createdBy: string;
  readonly reviewerIds: readonly string[];
  readonly activatedAt: string;
  readonly status: 'ACTIVE';
  readonly ruleDigest: string;
}
export interface AutomationEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly triggerType: AutomationTriggerType;
  readonly severity: AutomationSeverity;
  readonly occurredAt: string;
  readonly evidenceRoot: string;
  readonly attributes: Readonly<Record<string, string>>;
}
export interface ProposedAutomationAction {
  readonly actionId: string;
  readonly ruleId: string;
  readonly kind: AutomationActionKind;
  readonly title: string;
  readonly owner: string;
  readonly subjectId: string;
  readonly payload: Readonly<Record<string, string | number | boolean>>;
  readonly state: 'PROPOSAL_ONLY';
  readonly externalMutation: false;
}
export interface AutomationValueSignals {
  readonly classification: 'MODELED_LOCAL';
  readonly rulesEvaluated: number;
  readonly rulesMatched: number;
  readonly actionsProposed: number;
  readonly modeledManualRoutingDecisionsAvoided: number;
  readonly preventedAutomaticExternalEffects: number;
}
export interface GovernedAutomationRun {
  readonly runId: string;
  readonly eventId: string;
  readonly eventDigest: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly matchedRuleIds: readonly string[];
  readonly actions: readonly ProposedAutomationAction[];
  readonly valueSignals: AutomationValueSignals;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: 'PROPOSAL_ONLY';
  readonly promotionCeiling: 'research';
  readonly limitations: readonly string[];
  readonly runDigest: string;
}
interface StoredRule { readonly version: 1; readonly rule: GovernedAutomationRule; readonly digest: string; }
interface StoredRun { readonly version: 1; readonly eventDigest: string; readonly signedRun: SignedEnvelope<GovernedAutomationRun>; readonly digest: string; }

export interface GovernedAutomationStore {
  putRule(rule: GovernedAutomationRule): GovernedAutomationRule;
  rulesForTenant(tenantId: string): readonly GovernedAutomationRule[];
  getRun(eventId: string): StoredRun | undefined;
  putRun(eventDigest: string, signedRun: SignedEnvelope<GovernedAutomationRun>): StoredRun;
}

export class InMemoryGovernedAutomationStore implements GovernedAutomationStore {
  readonly #rules = new Map<string, StoredRule>();
  readonly #runs = new Map<string, StoredRun>();
  putRule(rule: GovernedAutomationRule): GovernedAutomationRule {
    const row = ruleRecord(rule); const prior = this.#rules.get(rule.ruleId);
    if (prior !== undefined && prior.digest !== row.digest) throw new Error('automation_rule_id_conflict');
    this.#rules.set(rule.ruleId, row); return structuredClone(row.rule);
  }
  rulesForTenant(tenantId: string): readonly GovernedAutomationRule[] {
    validateIdentifier(tenantId, 'automation_tenant_required');
    return [...this.#rules.values()].map((row) => { verifyRuleRecord(row); return row.rule; })
      .filter((rule) => rule.tenantId === tenantId).sort((a, b) => a.ruleId.localeCompare(b.ruleId)).map((rule) => structuredClone(rule));
  }
  getRun(eventId: string): StoredRun | undefined {
    validateIdentifier(eventId, 'automation_event_id_required'); const row = this.#runs.get(eventId);
    if (row === undefined) return undefined; verifyRunRecord(row); return structuredClone(row);
  }
  putRun(eventDigest: string, signedRun: SignedEnvelope<GovernedAutomationRun>): StoredRun {
    const row = runRecord(eventDigest, signedRun); const prior = this.#runs.get(signedRun.payload.eventId);
    if (prior !== undefined && prior.digest !== row.digest) throw new Error('automation_event_conflict');
    this.#runs.set(signedRun.payload.eventId, row); return structuredClone(row);
  }
}

export class FileGovernedAutomationStore implements GovernedAutomationStore {
  readonly #root: string; readonly #rulesRoot: string; readonly #runsRoot: string;
  constructor(root: string) {
    if (root.trim() === '') throw new Error('automation_store_root_required');
    this.#root = resolve(root); this.#rulesRoot = join(this.#root, 'rules'); this.#runsRoot = join(this.#root, 'runs');
    for (const path of [this.#root, this.#rulesRoot, this.#runsRoot]) { mkdirSync(path, { recursive: true, mode: 0o700 }); fsyncDirectory(path); }
  }
  putRule(rule: GovernedAutomationRule): GovernedAutomationRule {
    const row = ruleRecord(rule); const path = this.#rulePath(rule.ruleId); const stored = createOrRead(path, row) as StoredRule;
    verifyRuleRecord(stored); if (stored.digest !== row.digest) throw new Error('automation_rule_id_conflict'); return structuredClone(stored.rule);
  }
  rulesForTenant(tenantId: string): readonly GovernedAutomationRule[] {
    validateIdentifier(tenantId, 'automation_tenant_required');
    return readdirSync(this.#rulesRoot).filter((name) => name.endsWith('.json')).sort().map((name) => {
      const row = JSON.parse(readFileSync(join(this.#rulesRoot, name), 'utf8')) as StoredRule; verifyRuleRecord(row); return row.rule;
    }).filter((rule) => rule.tenantId === tenantId).sort((a, b) => a.ruleId.localeCompare(b.ruleId)).map((rule) => structuredClone(rule));
  }
  getRun(eventId: string): StoredRun | undefined {
    validateIdentifier(eventId, 'automation_event_id_required'); const path = this.#runPath(eventId); if (!existsSync(path)) return undefined;
    const row = JSON.parse(readFileSync(path, 'utf8')) as StoredRun; verifyRunRecord(row);
    if (row.signedRun.payload.eventId !== eventId) throw new Error('automation_run_store_key_mismatch'); return structuredClone(row);
  }
  putRun(eventDigest: string, signedRun: SignedEnvelope<GovernedAutomationRun>): StoredRun {
    const row = runRecord(eventDigest, signedRun); const stored = createOrRead(this.#runPath(signedRun.payload.eventId), row) as StoredRun;
    verifyRunRecord(stored); if (stored.digest !== row.digest) throw new Error('automation_event_conflict'); return structuredClone(stored);
  }
  #rulePath(ruleId: string): string { validateIdentifier(ruleId, 'automation_rule_id_required'); return join(this.#rulesRoot, `${sha256({ ruleId })}.json`); }
  #runPath(eventId: string): string { validateIdentifier(eventId, 'automation_event_id_required'); return join(this.#runsRoot, `${sha256({ eventId })}.json`); }
}

export class GovernedAutomationEngine {
  constructor(
    readonly keyRegistry: KeyRegistry,
    readonly runSigner: SigningIdentity,
    readonly store: GovernedAutomationStore = new InMemoryGovernedAutomationStore(),
  ) {}

  activate(input: Omit<GovernedAutomationRule, 'reviewerIds' | 'activatedAt' | 'status' | 'ruleDigest'> & { readonly reviewerIds: readonly string[] }, now = new Date()): GovernedAutomationRule {
    validateRuleInput(input, now);
    const reviewers = [...new Set(input.reviewerIds)].sort();
    const material = {
      ruleId: input.ruleId, tenantId: input.tenantId, name: input.name, triggerType: input.triggerType,
      condition: normalizeCondition(input.condition), actions: normalizeTemplates(input.actions), maxActions: input.maxActions,
      createdBy: input.createdBy, reviewerIds: reviewers, activatedAt: now.toISOString(), status: 'ACTIVE' as const,
    };
    const rule: GovernedAutomationRule = { ...material, ruleDigest: sha256(material) };
    return this.store.putRule(rule);
  }

  evaluate(event: AutomationEvent, now = new Date()): SignedEnvelope<GovernedAutomationRun> {
    validateEvent(event, now); const eventDigest = sha256(event); const prior = this.store.getRun(event.eventId);
    if (prior !== undefined) {
      if (prior.eventDigest !== eventDigest) throw new Error('automation_event_conflict');
      if (!this.keyRegistry.verify(prior.signedRun)) throw new Error('automation_run_signature_invalid');
      return structuredClone(prior.signedRun);
    }
    const rules = this.store.rulesForTenant(event.tenantId);
    const matched = rules.filter((rule) => rule.triggerType === event.triggerType && conditionMatches(rule.condition, event));
    const actionBudget = matched.reduce((sum, rule) => sum + rule.maxActions, 0);
    if (actionBudget > 50) throw new Error('automation_aggregate_action_budget_exceeded');
    const actions = matched.flatMap((rule) => rule.actions.slice(0, rule.maxActions).map((template) => actionFrom(rule, template, event)))
      .sort((a, b) => a.actionId.localeCompare(b.actionId));
    if (actions.length > 50) throw new Error('automation_action_budget_exceeded');
    const time = now.toISOString();
    const material = {
      runId: `automation-run:${sha256({ eventId: event.eventId, eventDigest }).slice(0, 24)}`,
      eventId: event.eventId, eventDigest, tenantId: event.tenantId, subjectId: event.subjectId,
      matchedRuleIds: matched.map((rule) => rule.ruleId).sort(), actions,
      valueSignals: {
        classification: 'MODELED_LOCAL' as const,
        rulesEvaluated: rules.length,
        rulesMatched: matched.length,
        actionsProposed: actions.length,
        modeledManualRoutingDecisionsAvoided: actions.length,
        preventedAutomaticExternalEffects: actions.length,
      },
      startedAt: time, finishedAt: time, status: 'PROPOSAL_ONLY' as const, promotionCeiling: 'research' as const,
      limitations: [
        'automation-actions-are-proposals-not-effects', 'dual-review-is-required-for-rule-activation',
        'modeled-value-signals-are-not-human-pilot-measurements', 'external-notification-and-mutation-are-disabled',
      ],
    };
    const run: GovernedAutomationRun = { ...material, runDigest: sha256(material) };
    const signed = signEnvelope(run, this.runSigner); this.store.putRun(eventDigest, signed); return structuredClone(signed);
  }
}

function validateRuleInput(input: Omit<GovernedAutomationRule, 'reviewerIds' | 'activatedAt' | 'status' | 'ruleDigest'> & { readonly reviewerIds: readonly string[] }, now: Date): void {
  for (const [name, value] of Object.entries({ ruleId: input.ruleId, tenantId: input.tenantId, name: input.name, createdBy: input.createdBy })) validateIdentifier(value, `automation_${name}_required`);
  if (!AUTOMATION_TRIGGER_TYPES.includes(input.triggerType)) throw new Error('automation_trigger_invalid');
  if (!Number.isFinite(now.getTime())) throw new Error('automation_rule_time_invalid');
  const reviewers = [...new Set(input.reviewerIds.filter((value) => value.trim() !== ''))];
  if (reviewers.length < 2 || reviewers.includes(input.createdBy)) throw new Error('automation_rule_dual_review_required');
  if (!Number.isInteger(input.maxActions) || input.maxActions < 1 || input.maxActions > 10) throw new Error('automation_rule_action_budget_invalid');
  if (input.actions.length === 0 || input.actions.length > input.maxActions) throw new Error('automation_rule_actions_invalid');
  normalizeCondition(input.condition); normalizeTemplates(input.actions);
}
function normalizeCondition(condition: AutomationRuleCondition): AutomationRuleCondition {
  if (condition.minimumSeverity !== undefined && !severityRank.has(condition.minimumSeverity)) throw new Error('automation_condition_severity_invalid');
  if (condition.subjectPrefix !== undefined && condition.subjectPrefix.trim() === '') throw new Error('automation_condition_subject_invalid');
  const attributeEquals = condition.attributeEquals === undefined ? undefined : Object.fromEntries(Object.entries(condition.attributeEquals).sort(([a], [b]) => a.localeCompare(b)));
  if (attributeEquals !== undefined && Object.entries(attributeEquals).some(([key, value]) => key.trim() === '' || value.trim() === '')) throw new Error('automation_condition_attribute_invalid');
  return { ...(condition.minimumSeverity === undefined ? {} : { minimumSeverity: condition.minimumSeverity }), ...(condition.subjectPrefix === undefined ? {} : { subjectPrefix: condition.subjectPrefix }), ...(attributeEquals === undefined ? {} : { attributeEquals }) };
}
function normalizeTemplates(actions: readonly AutomationActionTemplate[]): AutomationActionTemplate[] {
  const ids = new Set<string>();
  return actions.map((action) => {
    if (!AUTOMATION_ACTION_KINDS.includes(action.kind)) throw new Error('automation_action_kind_invalid');
    validateIdentifier(action.title, 'automation_action_title_required'); validateIdentifier(action.owner, 'automation_action_owner_required');
    const payload = action.payload === undefined ? {} : Object.fromEntries(Object.entries(action.payload).sort(([a], [b]) => a.localeCompare(b)));
    const fingerprint = sha256({ kind: action.kind, title: action.title, owner: action.owner, payload });
    if (ids.has(fingerprint)) throw new Error('automation_action_duplicate'); ids.add(fingerprint);
    return { kind: action.kind, title: action.title, owner: action.owner, payload };
  });
}
function validateEvent(event: AutomationEvent, now: Date): void {
  for (const [name, value] of Object.entries({ eventId: event.eventId, tenantId: event.tenantId, subjectId: event.subjectId })) validateIdentifier(value, `automation_${name}_required`);
  if (!AUTOMATION_TRIGGER_TYPES.includes(event.triggerType)) throw new Error('automation_event_trigger_invalid');
  if (!severityRank.has(event.severity)) throw new Error('automation_event_severity_invalid');
  const occurred = Date.parse(event.occurredAt); if (!Number.isFinite(occurred) || occurred > now.getTime() + 60_000) throw new Error('automation_event_time_invalid');
  if (!/^[a-f0-9]{64}$/.test(event.evidenceRoot)) throw new Error('automation_event_evidence_root_invalid');
  if (Object.entries(event.attributes).some(([key, value]) => key.trim() === '' || value.trim() === '')) throw new Error('automation_event_attributes_invalid');
}
const severityRank = new Map<AutomationSeverity, number>([['low', 1], ['medium', 2], ['high', 3], ['critical', 4]]);
function conditionMatches(condition: AutomationRuleCondition, event: AutomationEvent): boolean {
  if (condition.minimumSeverity !== undefined && (severityRank.get(event.severity) ?? 0) < (severityRank.get(condition.minimumSeverity) ?? 0)) return false;
  if (condition.subjectPrefix !== undefined && !event.subjectId.startsWith(condition.subjectPrefix)) return false;
  if (condition.attributeEquals !== undefined && Object.entries(condition.attributeEquals).some(([key, value]) => event.attributes[key] !== value)) return false;
  return true;
}
function actionFrom(rule: GovernedAutomationRule, template: AutomationActionTemplate, event: AutomationEvent): ProposedAutomationAction {
  const payload = { ...(template.payload ?? {}), eventId: event.eventId, evidenceRoot: event.evidenceRoot, severity: event.severity };
  return {
    actionId: `automation-action:${sha256({ ruleId: rule.ruleId, eventId: event.eventId, kind: template.kind, title: template.title, payload }).slice(0, 24)}`,
    ruleId: rule.ruleId, kind: template.kind, title: template.title, owner: template.owner, subjectId: event.subjectId,
    payload, state: 'PROPOSAL_ONLY', externalMutation: false,
  };
}
function ruleRecord(rule: GovernedAutomationRule): StoredRule { verifyRule(rule); const material = { version: 1 as const, rule: structuredClone(rule) }; return { ...material, digest: sha256(material) }; }
function verifyRule(rule: GovernedAutomationRule): void { const { ruleDigest, ...material } = rule; if (ruleDigest !== sha256(material) || rule.status !== 'ACTIVE') throw new Error('automation_rule_tampered'); }
function verifyRuleRecord(row: StoredRule): void { const { digest, ...material } = row; if (row.version !== 1 || digest !== sha256(material)) throw new Error('automation_rule_store_tampered'); verifyRule(row.rule); }
function runRecord(eventDigest: string, signedRun: SignedEnvelope<GovernedAutomationRun>): StoredRun { if (!/^[a-f0-9]{64}$/.test(eventDigest)) throw new Error('automation_event_digest_invalid'); verifyRun(signedRun.payload); const material = { version: 1 as const, eventDigest, signedRun: structuredClone(signedRun) }; return { ...material, digest: sha256(material) }; }
function verifyRun(run: GovernedAutomationRun): void { const { runDigest, ...material } = run; if (runDigest !== sha256(material) || run.status !== 'PROPOSAL_ONLY' || run.promotionCeiling !== 'research' || run.actions.some((action) => action.externalMutation !== false || action.state !== 'PROPOSAL_ONLY')) throw new Error('automation_run_tampered'); }
function verifyRunRecord(row: StoredRun): void { const { digest, ...material } = row; if (row.version !== 1 || digest !== sha256(material)) throw new Error('automation_run_store_tampered'); verifyRun(row.signedRun.payload); }
function validateIdentifier(value: string, code: string): void { if (value.trim() === '' || value.length > 1024) throw new Error(code); }
function createOrRead(path: string, value: unknown): unknown {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, `${canonicalJson(value)}\n`, 'utf8');
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    try {
      linkSync(temporary, path);
      fsyncDirectory(directory);
      return value;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST')) throw error;
      return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) {
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
    }
  }
}
function fsyncDirectory(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
