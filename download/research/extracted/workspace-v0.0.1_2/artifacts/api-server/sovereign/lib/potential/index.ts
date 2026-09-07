/**
 * lib/potential/index.ts — barrel export for the Potential Engine module.
 *
 * Public API:
 *   PotentialEngine — main entry point (analyze + route via TfaOrchestrator).
 *   StrengthMapper  — maps KG + analytics signals to a StrengthProfile.
 *   OpportunityRouter — matches a StrengthProfile to Opportunities.
 *   Types           — all shared types.
 */

export { PotentialEngine } from "./potential-engine.ts";
export type { PassportIssuanceOptions } from "./potential-engine.ts";
export { CollaborationEscrowBridge, COLLABORATION_ESCROW_ACTION_TYPE } from "./collaboration-escrow-bridge.ts";
export type { CollaborationEscrowInput, CollaborationEscrowResult, EscrowPassportOptions } from "./collaboration-escrow-bridge.ts";
export { StrengthMapper } from "./strength-mapper.ts";
export { OpportunityRouter } from "./opportunity-router.ts";
export { PersonalityMapper, DEFAULT_TRAIT_MAP } from "./personality-mapper.ts";
export { SuccessPathRouter } from "./success-path-router.ts";
export { CollaborationMatcher } from "./collaboration-matcher.ts";
export { PgPersonalityStore, PersonalityStoreError } from "./pg-personality-store.ts";
export type { PersonalityStoreErrorCode } from "./pg-personality-store.ts";
export { PgSuccessPathStore, SuccessPathStoreError } from "./pg-success-path-store.ts";
export type { SuccessPathStoreErrorCode } from "./pg-success-path-store.ts";
export { PgCollaborationStore, CollaborationStoreError } from "./pg-collaboration-store.ts";
export type { CollaborationStoreErrorCode } from "./pg-collaboration-store.ts";
export { InMemoryKnowledgeGraphSource } from "./in-memory-kg-source.ts";
export { PgKnowledgeGraphSource, KgSourceError } from "./pg-kg-source.ts";
export type { KgSourceErrorCode } from "./pg-kg-source.ts";
export { POTENTIAL_ACTION_TYPES } from "./types.ts";
export type { PotentialActionType } from "./types.ts";
export type {
  KnowledgeSignal,
  AnalyticsSignal,
  UserStrength,
  StrengthProfile,
  Opportunity,
  OpportunityMatch,
  RoutingDecision,
  AnalysisInput,
  RoutingInput,
  StrengthCategory,
  ISOTimestamp,
  PotentialEngineResult,
  KnowledgeGraphSource,
} from "./types.ts";
export type {
  PersonalityTraits,
  PersonalityProfile,
  TraitEvidence,
  EnrichedProfile,
  LearningStep,
  SuccessPath,
  SuccessPathInput,
  CollaborationMatch,
  CollaborationInput,
} from "./personality-types.ts";
