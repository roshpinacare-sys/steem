/**
 * lib/escrow-client/index.ts — barrel export for the external Escrow SDK.
 */

export {
  fetchEscrow,
  createEscrow,
  fundEscrow,
  releaseEscrow,
  refundEscrow,
} from "./escrow-client.ts";

export { EscrowClientError } from "./types.ts";

export type {
  EscrowFetchOptions,
  EscrowClientErrorCode,
  FetchEscrowResult,
  CreateEscrowResult,
  MutateEscrowResult,
} from "./types.ts";
