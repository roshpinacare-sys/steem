// הצהרת טיפוסים לספר הטוקנים החי (console/saos-live.js) — UMD איזומורפי:
// בדפדפן הוא window.SaosLive, ב-bun (הלב הענני) — ייבוא ישיר.
// המקור הקנוני חי בריפו הריבוני (console/) ומפורסם ל-Console של Pages.
// אותו קוד בדיוק רץ בכל צומת — אפס הסתעפות בין דפדפן לענן.
declare module "*/saos-live.js" {
  export const PROTOCOL: string;
  export const OP_ID: string;
  export const SAOS_GENESIS: {
    symbol: string;
    name: string;
    decimals: number;
    maxSupply: string;
    initialMint: string;
    note: string;
  };
  export const ADDR_RE: RegExp;
  export function canon(v: unknown): string;
  export function addressFromPubSTM(stm: string): Promise<string>;
  export function digestFor(envelope: Record<string, unknown>): Promise<Uint8Array>;
  export function signEnvelope(envelope: Record<string, unknown>, privBytes: Uint8Array): Promise<string>;
  export function recoverPub(digest32: Uint8Array, sigHex: string): Uint8Array | null;
  export function validateEnvelope(
    env: Record<string, unknown>,
    state: unknown,
    seenIds: Set<string>,
    seenPubs: Set<string>,
  ): Promise<{ ok?: boolean; err?: string }>;
  export interface SaosFoldResult {
    ok: boolean;
    protocol: string;
    valid: number;
    invalid: { id: string; k: string; err: string }[];
    order: { id: string; k: string; by: string; at: string | null; txid: string | null }[];
    state: {
      wallets: Record<string, { pub: string; nick: string | null; at: string | null; txid: string | null }>;
      tokens: Record<string, { name: string; decimals: number; maxSupply: string; issuer: string; at: string | null; txid: string | null }>;
      bal: Record<string, Record<string, bigint>>;
      supply: Record<string, bigint>;
    };
    stateRoot: string;
    balCanon: Record<string, Record<string, string>>;
    supplyCanon: Record<string, string>;
  }
  export function fold(envelopes: Record<string, unknown>[]): Promise<SaosFoldResult>;
  export function buildOp(privBytes: Uint8Array, pubSTM: string, fields: Record<string, unknown>): Promise<Record<string, unknown>>;
  export function buildGenesisOps(
    treasuryPrivBytes: Uint8Array,
    treasuryPubSTM: string,
  ): Promise<{ treasury: string; ops: Record<string, unknown>[] }>;
  export function newWallet(): Promise<{ priv: Uint8Array; pubSTM: string; addr: string }>;
  export function randomPriv(): Uint8Array;
  export function fmt(units: string | bigint, decimals: number): string;
  export function selfTest(): Promise<{ passed: number; total: number; tests: { name: string; pass: boolean; detail?: string | null }[]; protocol: string }>;
}

declare module "*/gate-crypto.js" {
  export const STEEM_CHAIN_ID: string;
  export function sha256(data: Uint8Array | string): Promise<Uint8Array>;
  export function b58encode(bytes: Uint8Array): string;
  export function b58cEncode(version: number, payload: Uint8Array): Promise<string>;
  export function hex(bytes: Uint8Array): string;
  export function unhex(s: string): Uint8Array;
  export function cat(...arrs: Uint8Array[]): Uint8Array;
  export function rmd160(bytes: Uint8Array): Uint8Array;
  export function privToPubBytes(priv: Uint8Array): Uint8Array;
  export function pubToSTM(pub33: Uint8Array): Promise<string>;
  export function stmToPub(stm: string): Uint8Array;
  export function wifToPriv(wif: string): Promise<Uint8Array>;
  export function serializeTx(tx: unknown): Uint8Array;
  export function signCompact(digest32: Uint8Array, priv: Uint8Array): Promise<Uint8Array>;
  export function buildSignedTx(
    ops: unknown[],
    priv: Uint8Array,
    getProps: () => Promise<unknown>,
    getBlockHeader: (n: number) => Promise<unknown>,
  ): Promise<unknown>;
}
