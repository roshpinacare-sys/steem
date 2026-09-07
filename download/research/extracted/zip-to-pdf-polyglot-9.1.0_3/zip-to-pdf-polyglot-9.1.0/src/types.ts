// src/lib/polyglot/types.ts
// v8.1: added chacha20-poly1305, rsa-signed strategies + passphrase/key options.

export type StrategyName =
  | "agent-readable"
  | "raw-polyglot-patched"
  | "raw-polyglot-unpatched"
  | "pdf-attachment"
  | "xmp-embedded"
  | "portfolio"
  | "raw-polyglot-signed"
  | "encrypted"
  | "chacha20-poly1305"
  | "rsa-signed";

export interface BuildOptions {
  strategy?: StrategyName;
  excludeCruft?: boolean;
  canonical?: boolean;
  embedFont?: boolean;
  contentCompression?: "flate" | "brotli";
  embedDiagram?: boolean;
  /** v8.1: passphrase for encrypted / chacha20-poly1305 strategies */
  passphrase?: string;
  /** v8.1 rsa-signed: optional pre-generated private key PEM */
  privateKeyPem?: string;
  /** v8.1 rsa-signed: optional pre-generated public key PEM */
  publicKeyPem?: string;
  onLog?: (msg: string) => void;
  onProgress?: (done: number, total: number, msg: string) => void;
}

export interface ExtractOptions {
  strategy?: StrategyName;
  canonical?: boolean;
  /** v8.1: passphrase for encrypted / chacha20-poly1305 strategies */
  passphrase?: string;
  onLog?: (msg: string) => void;
}

export interface BuildResult {
  bytes: Uint8Array;
  strategy: StrategyName;
  entryCount: number;
  originalSize: number;
  pdfSize: number;
  textFileCount: number;
  binaryFileCount: number;
  dedupCount: number;
  excludedCount: number;
  readableSample: string;
  manifestSummary: ManifestSummary;
  logs: string[];
  /** v8.1 rsa-signed: private key PEM (not embedded in PDF — keep secure) */
  privateKeyPem?: string;
  /** v8.1 rsa-signed: public key PEM embedded in PDF */
  publicKeyPem?: string;
  /** v8.1 rsa-signed: hex-encoded RSA signature */
  signatureHex?: string;
}

export interface ExtractResult {
  bytes: Uint8Array;
  strategy: StrategyName;
  entryCount: number;
  zipSize: number;
  files: { name: string; size: number; type: "text" | "binary" }[];
  logs: string[];
  /** v8.1 rsa-signed: whether the embedded RSA signature verified */
  signatureValid?: boolean;
}

export interface VerifyReport {
  recognized: boolean;
  strategy: StrategyName | null;
  entryCount: number | null;
  pdfMagic: boolean;
  errors: string[];
}

export interface ManifestFile {
  i: number;
  name: string;
  size: number;
  sha: string;
  type: "text" | "binary";
  lineStart?: number;
  lineCount?: number;
  lineRefs?: number[];
  fileLineTerms?: number[];
  ref?: number;
  blob?: number;
  shard?: number;
}

export interface ManifestSummary {
  fileCount: number;
  textFileCount: number;
  binaryFileCount: number;
  dedupCount: number;
  excludedCount: number;
  totalOriginalBytes: number;
  totalLines?: number;
  uniqueLines?: number;
  dedupLines?: number;
}

export interface FullManifest {
  v: 2;
  strategy: StrategyName;
  origName: string;
  textStartPage: number;
  textPageCount: number;
  binaryStoreObj: number;
  textFiles: ManifestFile[];
  files: ManifestFile[];
  summary: ManifestSummary;
  lineTerms?: number[];
  textEncoding?: "utf16cid";
  astralMap?: Record<number, number>;
  compression?: "flate" | "brotli";
  lineDedup?: boolean;
  merkleRoot?: string;
  tests?: ManifestTest[];
  pipeline?: PipelineStep[];
  isIndex?: boolean;
  shardCount?: number;
  agentProtocol?: AgentProtocol;
  jsActions?: JsAction[];
  hostHooks?: HostHook[];
  tools?: ToolAttachment[];
  deltaProvenance?: DeltaProvenance;
  imagePageCount?: number;
  images?: ManifestImage[];
}

export interface ManifestImage {
  name: string;
  format: "jpeg" | "png" | "gif" | "svg";
  width: number;
  height: number;
  size: number;
  embedded: boolean;
  xobjNum?: number;
  blob?: number;
  ref?: number;
}

export interface HostHook {
  module: string;
  capability: string;
  description: string;
}

export interface ToolAttachment {
  name: string;
  type: string;
  path: string;
  cmd: string;
  exit?: number;
  expect?: string;
}

export interface DeltaProvenance {
  baseMerkleRoot: string;
  deltaCount: number;
  appliedAt: string;
  author?: string;
}

export interface DeltaEntry {
  path: string;
  action: "add" | "modify" | "delete";
  content?: string;
  crc32: number;
  oldCrc32?: number;
  sha256: string;
}

export interface DeltaStream {
  version: 1;
  baseMerkleRoot: string;
  resultMerkleRoot: string;
  entries: DeltaEntry[];
  createdAt: string;
  author?: string;
  description?: string;
}

export interface AgentProtocol {
  systemPrompt: string;
  tools: AgentToolDef[];
  suggestedActions: string[];
  apiBase?: string;
  moduleManifest?: ModuleManifest;
}

export interface AgentToolDef {
  name: string;
  description: string;
  endpoint: string;
  method: string;
  exampleArgs?: Record<string, string>;
}

export interface ModuleCapability {
  id: string;
  name: string;
  description: string;
  invoke: {
    cli?: string;
    api?: string;
    method?: string;
    inputSchema?: Record<string, unknown>;
  };
  requiresServer: boolean;
  offlineCapable: boolean;
}

export interface ModuleManifest {
  version: "5.0";
  description: string;
  modules: ModuleCapability[];
  bootstrap: string[];
  systemPrompt: string;
}

export interface JsAction {
  label: string;
  js: string;
}

export interface ManifestTest {
  name: string;
  file: string;
  sha: string;
  contains?: string;
}

export interface PipelineStep {
  step: string;
  desc: string;
  cmd: string;
  exit?: number;
  expect?: string;
}
