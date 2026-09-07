export interface ReplayConsumption {
  readonly replayKey: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly evidenceRoot: string;
  readonly consumedAt: string;
  readonly consumerId?: string;
}

export interface ReplayLedger {
  tryConsume(input: ReplayConsumption): boolean;
  has(replayKey: string): boolean;
}
