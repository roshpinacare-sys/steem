// Ambient declarations for packages hoisted to the monorepo root node_modules.
declare module "jsdom";
declare module "semver";

// onnxruntime-web — WASM inference runtime (Tier-0 classifier).
// Declared as ambient so tsc does not require the package at compile time;
// the import is dynamic and guarded with .catch(() => null).
declare module "onnxruntime-web" {
  export class Tensor {
    constructor(type: string, data: Float32Array, dims: number[]);
    readonly data: ArrayLike<number>;
  }
  export class InferenceSession {
    static create(modelPath: string): Promise<InferenceSession>;
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }
}

// Cloudflare Workers runtime global — injected by the CF Workers runtime.
// Declared here so ai-router.ts can reference globalThis._cfEnv without
// a "Property does not exist" strict-mode error.
interface CloudflareAIBinding {
  run(
    model: string,
    inputs: Record<string, unknown>,
  ): Promise<{ response?: string; [k: string]: unknown }>;
}

declare global {
  var _cfEnv: { AI?: CloudflareAIBinding } | undefined;
}
