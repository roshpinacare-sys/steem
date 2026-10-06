// ─────────────────────────────────────────────────────────────────────
// הכרזת טיפוסים מינימלית לחבילת steem (steem-js 0.7.11) — רק ה-API
// שבו weave-anchor משתמש: signTransaction (חתימה מקומית) ו-broadcast
// (שידור Steem). הדפוס המוכח של הצי (anchor.cjs) — ללא שינויים.
// ─────────────────────────────────────────────────────────────────────

declare module "steem" {
  export interface GrapheneOperation {
    [index: number]: string | Record<string, unknown>;
    0: string;
    1: Record<string, unknown>;
  }

  export interface GrapheneTransaction {
    ref_block_num: number;
    ref_block_prefix: number;
    expiration: string;
    operations: GrapheneOperation[];
    extensions: unknown[];
  }

  export interface SignedGrapheneTransaction extends GrapheneTransaction {
    signatures: string[];
  }

  interface SteemAuth {
    signTransaction(tx: GrapheneTransaction, keys: string[]): SignedGrapheneTransaction;
    wifToPublic(wif: string): { toString(): string };
  }

  interface SteemBroadcast {
    sendAsync(
      tx: { operations: GrapheneOperation[]; extensions: unknown[] },
      keys: string[]
    ): Promise<{ id: string }>;
  }

  interface SteemConfig {
    get(key: string): string;
    set(key: string, value: string): void;
  }

  const steem: {
    auth: SteemAuth;
    broadcast: SteemBroadcast;
    config: SteemConfig;
  };

  export default steem;
}
