import { sha256 } from '../contracts/crypto.js';

export type ModelLifecycleStatus = 'ACTIVE' | 'DEPRECATED' | 'RETIRED' | 'BLOCKED';

export interface ModelLifecycleRecord {
  readonly modelId: string;
  readonly providerId: string;
  readonly status: ModelLifecycleStatus;
  readonly allowedPurposes: readonly string[];
  readonly deprecatedAt?: string;
  readonly retiresAt?: string;
  readonly replacementModelId?: string;
  readonly evidenceRef: string;
}

export interface ModelUseRequest {
  readonly modelId: string;
  readonly providerId: string;
  readonly purpose: string;
  readonly environment: 'development' | 'test' | 'staging' | 'production';
}

export interface ModelLifecycleDecision {
  readonly status: 'ALLOW' | 'WARN' | 'BLOCK';
  readonly modelId: string;
  readonly replacementModelId?: string;
  readonly reasons: readonly string[];
  readonly evidenceRef?: string;
  readonly decisionDigest: string;
}

/** Qodo-derived model-deprecation behavior, reduced to a fail-closed deterministic policy component. */
export class ModelLifecycleWatchdog {
  readonly #records = new Map<string, ModelLifecycleRecord>();

  constructor(records: readonly ModelLifecycleRecord[]) {
    for (const record of records) {
      validateRecord(record);
      const key = recordKey(record.providerId, record.modelId);
      if (this.#records.has(key)) throw new Error(`model_lifecycle_duplicate:${key}`);
      this.#records.set(key, { ...record, allowedPurposes: [...new Set(record.allowedPurposes)].sort() });
    }
  }

  evaluate(request: ModelUseRequest, now = new Date()): ModelLifecycleDecision {
    if (!Number.isFinite(now.getTime())) throw new Error('model_lifecycle_time_invalid');
    const record = this.#records.get(recordKey(request.providerId, request.modelId));
    const reasons: string[] = [];
    if (record === undefined) return decision(request.modelId, 'BLOCK', ['MODEL_UNKNOWN']);
    if (!record.allowedPurposes.includes(request.purpose)) reasons.push('PURPOSE_NOT_ALLOWED');
    if (record.status === 'BLOCKED') reasons.push('MODEL_POLICY_BLOCKED');
    if (record.status === 'RETIRED') reasons.push('MODEL_RETIRED');
    if (record.retiresAt !== undefined && now.getTime() >= Date.parse(record.retiresAt)) reasons.push('RETIREMENT_EFFECTIVE');
    if (reasons.length > 0) return decision(record.modelId, 'BLOCK', reasons, record);

    const deprecated = record.status === 'DEPRECATED'
      || (record.deprecatedAt !== undefined && now.getTime() >= Date.parse(record.deprecatedAt));
    if (deprecated) {
      if (request.environment === 'production' && record.replacementModelId === undefined) {
        return decision(record.modelId, 'BLOCK', ['DEPRECATED_WITHOUT_REPLACEMENT'], record);
      }
      return decision(record.modelId, 'WARN', ['MODEL_DEPRECATED', ...(record.replacementModelId === undefined ? [] : ['MIGRATION_REQUIRED'])], record);
    }
    return decision(record.modelId, 'ALLOW', [], record);
  }
}

function decision(modelId: string, status: ModelLifecycleDecision['status'], reasons: readonly string[], record?: ModelLifecycleRecord): ModelLifecycleDecision {
  const material = {
    status,
    modelId,
    ...(record?.replacementModelId === undefined ? {} : { replacementModelId: record.replacementModelId }),
    reasons: [...reasons].sort(),
    ...(record === undefined ? {} : { evidenceRef: record.evidenceRef }),
  };
  return { ...material, decisionDigest: sha256(material) };
}

function validateRecord(record: ModelLifecycleRecord): void {
  if (record.modelId.trim() === '' || record.providerId.trim() === '' || record.evidenceRef.trim() === '') throw new Error('model_lifecycle_record_invalid');
  if (record.allowedPurposes.length === 0 || record.allowedPurposes.some((purpose) => purpose.trim() === '')) throw new Error('model_lifecycle_purpose_invalid');
  for (const instant of [record.deprecatedAt, record.retiresAt]) if (instant !== undefined && !Number.isFinite(Date.parse(instant))) throw new Error('model_lifecycle_instant_invalid');
  if (record.deprecatedAt !== undefined && record.retiresAt !== undefined && Date.parse(record.deprecatedAt) >= Date.parse(record.retiresAt)) throw new Error('model_lifecycle_window_invalid');
  if (record.replacementModelId === record.modelId) throw new Error('model_lifecycle_self_replacement');
}

function recordKey(providerId: string, modelId: string): string { return `${providerId.trim()}::${modelId.trim()}`; }
