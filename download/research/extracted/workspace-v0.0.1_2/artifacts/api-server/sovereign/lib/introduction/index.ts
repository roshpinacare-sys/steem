/**
 * lib/introduction — barrel export.
 */
export type {
  ProofTarget,
  ProofTargetKind,
  IntroductionRequest,
  IntroductionRequestInput,
} from "./types.ts";
export {
  InMemoryIntroductionStore,
  type IntroductionStore,
} from "./introduction-store.ts";
export { PgIntroductionStore } from "./pg-introduction-store.ts";
