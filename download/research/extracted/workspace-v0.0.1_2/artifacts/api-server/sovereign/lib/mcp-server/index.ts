/**
 * lib/mcp-server/index.ts — barrel export for TFA MCP Server.
 */

export {
  TfaMcpServer,
  getTfaMcpTools,
  deriveToolAnnotations,
  MCP_TOOL_RISK_MAP,
  type TfaMcpServerConfig,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpTool,
  type McpServerCapabilities,
} from "./mcp-server.ts";

export {
  issueCapabilityToken,
  verifyCapabilityToken,
  encodeCapabilityToken,
  decodeCapabilityToken,
  extractNonce,
  CAPABILITY_TOKEN_DEFAULT_TTL_MS,
  CapabilityError,
  type ApprovalCapabilityToken,
  type CapabilityVerifyResult,
} from "./capability-token.ts";

export {
  InMemoryNonceRegistry,
  PgNonceRegistry,
  type NonceRegistry,
} from "./nonce-registry.ts";
