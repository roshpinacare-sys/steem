// lib/polyglot/src/index.ts
// Public API surface for @workspace/polyglot v8.1

export {
  buildPolyglot,
  extractPolyglot,
  verifyPolyglot,
  listStrategies,
  buildPolyglotSharded,
  extractPolyglotSharded,
  STRATEGIES,
  DEFAULT_STRATEGY,
} from "./polyglot";

export type { StrategyModule } from "./polyglot";

export type {
  StrategyName,
  BuildOptions,
  BuildResult,
  ExtractOptions,
  ExtractResult,
  VerifyReport,
  ManifestFile,
  ManifestSummary,
  FullManifest,
  ManifestImage,
  AgentProtocol,
  AgentToolDef,
  ModuleCapability,
  ModuleManifest,
  JsAction,
  ManifestTest,
  PipelineStep,
  DeltaEntry,
  DeltaStream,
  DeltaProvenance,
  HostHook,
  ToolAttachment,
} from "./types";

// Lower-level re-exports for MCP server / CLI
export {
  u16,
  u32,
  writeU32,
  concatBytes,
  sanitizeForPdfText,
  toHex,
  fromHex,
  findBytes,
} from "./bytes";

export { findEOCD } from "./zip-reader";

export {
  extractTjLines,
  findPageContentsRefs,
  findPolyglotRefs,
  pageContentsRef,
  readObjectStream,
} from "./pdf-reader";
