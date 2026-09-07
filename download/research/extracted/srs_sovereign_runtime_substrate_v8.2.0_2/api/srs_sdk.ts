/**
 * SRS TypeScript SDK — Auto-generated from OpenAPI 3.0 spec.
 *
 * Usage:
 *   import { SRSCClient } from './srs_sdk';
 *   const client = new SRSCClient('http://localhost:8000', 'api-key');
 *   const result = await client.submitMutation({ ... });
 */

export interface HealthResponse {
  status: string;
  version: string;
  tests_passing: number;
  coverage: string;
}

export interface APIKeyResponse {
  key_id: string;
  api_key: string;
  identity_id: string;
  tenant_id: string;
}

export interface MutationRequest {
  mutation_id: string;
  description: string;
  risk_class: string;
  z3_witness_hash: string;
  evidence_chain: Record<string, any>;
  validators: Array<{
    validator_id: string;
    validator_type: string;
    admit: boolean;
    assurance: number;
    rationale?: string;
  }>;
  seq: number;
}

export interface MutationResponse {
  mutation_id: string;
  admissible: boolean;
  reason: string;
  certified_at: number;
}

export interface AuditEvent {
  event_id: string;
  timestamp: number;
  tenant_id: string;
  identity_id: string;
  action: string;
  resource: string;
  outcome: string;
  prev_hash: string;
  event_hash: string;
  metadata: Record<string, any>;
}

export interface AuditQueryResponse {
  events: AuditEvent[];
  count: number;
}

export interface AuditVerifyResponse {
  valid: boolean;
  event_count: number;
}

export interface Policy {
  policy_id: string;
  name: string;
  effect: string;
  priority: number;
  enabled: boolean;
}

export interface PoliciesResponse {
  policies: Policy[];
}

export interface CostReport {
  total_events: number;
  total_cost_micro: number;
  total_cost_dollars: number;
  by_operation: Record<string, number>;
  budgets: Record<string, any>;
}

export interface Stats {
  seg: Record<string, any>;
  audit: Record<string, any>;
  identities: number;
  tenants: number;
  api_keys: number;
  policies: number;
  budgets: number;
}

export class SRSCClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${error}`);
    }
    return resp.json() as Promise<T>;
  }

  async health(): Promise<HealthResponse> {
    return this.request('GET', '/v1/health');
  }

  async issueApiKey(params: {
    tenant_id: string;
    identity_id: string;
    role?: string;
    display_name?: string;
    ttl_seconds?: number;
  }): Promise<APIKeyResponse> {
    return this.request('POST', '/v1/auth/api-key', params);
  }

  async submitMutation(params: MutationRequest): Promise<MutationResponse> {
    return this.request('POST', '/v1/mutations', params);
  }

  async queryAudit(params?: {
    tenant_id?: string;
    identity_id?: string;
    action?: string;
    resource?: string;
  }): Promise<AuditQueryResponse> {
    const qs = new URLSearchParams();
    if (params?.tenant_id) qs.set('tenant_id', params.tenant_id);
    if (params?.identity_id) qs.set('identity_id', params.identity_id);
    if (params?.action) qs.set('action', params.action);
    if (params?.resource) qs.set('resource', params.resource);
    const path = `/v1/audit${qs.toString() ? '?' + qs.toString() : ''}`;
    return this.request('GET', path);
  }

  async verifyAudit(): Promise<AuditVerifyResponse> {
    return this.request('GET', '/v1/audit/verify');
  }

  async listPolicies(): Promise<PoliciesResponse> {
    return this.request('GET', '/v1/policies');
  }

  async costReport(params?: { tenant_id?: string; agent_id?: string }): Promise<CostReport> {
    const qs = new URLSearchParams();
    if (params?.tenant_id) qs.set('tenant_id', params.tenant_id);
    if (params?.agent_id) qs.set('agent_id', params.agent_id);
    const path = `/v1/cost/report${qs.toString() ? '?' + qs.toString() : ''}`;
    return this.request('GET', path);
  }

  async stats(): Promise<Stats> {
    return this.request('GET', '/v1/stats');
  }
}
