#!/usr/bin/env node
// mcp-server/index.ts — Model Context Protocol server for zip-to-pdf-polyglot v9.1.0
//
// Protocol: JSON-RPC 2.0 over stdin/stdout (one JSON object per line).
// Start:    npm run mcp   OR   npx tsx mcp-server/index.ts
//
// Tools:
//   list_strategies    List all 10 strategies with metadata
//   build_polyglot     Build a ZIP → polyglot PDF
//   extract_polyglot   Extract canonical ZIP from a polyglot PDF
//   verify_polyglot    Non-throwing structural verification (marker-only for encrypted)
//   readable_sample    Read N lines from the agent-readable text layer (fast path)
//   get_capabilities   Server info + tool list

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import {
  buildPolyglot,
  extractPolyglot,
  verifyPolyglot,
  listStrategies,
  findPolyglotRefs,
  readObjectStream,
  findPageContentsRefs,
  pageContentsRef,
  extractTjLines,
} from "../src/index";
import type { StrategyName } from "../src/types";

const VERSION = "9.1.0";

// ── JSON-RPC 2.0 types ─────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const ERR_PARSE_ERROR      = -32700;
const ERR_INVALID_REQUEST  = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS   = -32602;
const ERR_INTERNAL         = -32603;

// ── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "list_strategies",
    description: "List all 10 polyglot strategies with metadata (badge, requiresPassphrase, isTrueByteLevelPolyglot, isExtractable).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "build_polyglot",
    description:
      "Build a ZIP archive into a polyglot PDF. Supports all 10 strategies. " +
      "Passphrase strategies (encrypted, chacha20-poly1305) REQUIRE the passphrase field — " +
      "there is no default passphrase (security fix in v9.1).",
    inputSchema: {
      type: "object",
      required: ["zipPath"],
      properties: {
        zipPath:            { type: "string",  description: "Absolute path to the source ZIP." },
        strategy:           { type: "string",  description: "Strategy name (default: agent-readable)" },
        outPath:            { type: "string",  description: "Output PDF path (default: zipPath + .polyglot.pdf)" },
        excludeCruft:       { type: "boolean", description: "Skip node_modules, .git, dist, etc. (default: true)" },
        embedFont:          { type: "boolean", description: "Embed TTF font subset (default: true)" },
        embedDiagram:       { type: "boolean", description: "Embed file-tree diagram page (default: true)" },
        contentCompression: { type: "string",  description: "flate or brotli (default: flate)" },
        passphrase:         { type: "string",  description: "REQUIRED for encrypted and chacha20-poly1305 strategies" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "extract_polyglot",
    description:
      "Extract the canonical ZIP from a polyglot PDF. Auto-detects strategy. " +
      "Passphrase required for encrypted/chacha20-poly1305 files.",
    inputSchema: {
      type: "object",
      required: ["pdfPath"],
      properties: {
        pdfPath:    { type: "string",  description: "Absolute path to the polyglot PDF." },
        outPath:    { type: "string",  description: "Output ZIP path (default: pdfPath with .zip extension)" },
        canonical:  { type: "boolean", description: "Produce canonical (sorted, fixed timestamps) ZIP (default: true)" },
        passphrase: { type: "string",  description: "Passphrase for encrypted strategies" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "verify_polyglot",
    description:
      "Non-throwing structural verification. For encrypted strategies, uses marker-only " +
      "detection (no decryption, no passphrase needed) so it's always fast.",
    inputSchema: {
      type: "object",
      required: ["pdfPath"],
      properties: { pdfPath: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "readable_sample",
    description:
      "Read N lines from the agent-readable text layer of an agent-readable polyglot PDF. " +
      "Uses a fast direct-read path (no ZIP extraction). Only works with agent-readable strategy.",
    inputSchema: {
      type: "object",
      required: ["pdfPath"],
      properties: {
        pdfPath: { type: "string" },
        n:       { type: "number", description: "Number of lines to read (default: 120, max: 2000)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_capabilities",
    description: "Return capabilities of this MCP server (tool list, version, strategy count).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

// ── Handlers ───────────────────────────────────────────────────────────────

type Params = Record<string, unknown>;

function handleListStrategies(_p: Params): unknown {
  return { strategies: listStrategies() };
}

function handleBuild(params: Params): unknown {
  const zipPath = params["zipPath"] as string;
  if (!zipPath) throw new Error("zipPath is required");

  const zipBuf   = new Uint8Array(readFileSync(zipPath));
  const origName = zipPath.split(/[\\/]/).pop() ?? "archive.zip";
  const strategy = (params["strategy"] as StrategyName | undefined) ?? "agent-readable";
  const outPath  = (params["outPath"] as string | undefined)
    ?? zipPath.replace(/\.zip$/i, "") + ".polyglot.pdf";
  const logs: string[] = [];

  const result = buildPolyglot(zipBuf, origName, {
    strategy,
    excludeCruft:       params["excludeCruft"]       !== false,
    embedFont:          params["embedFont"]           !== false,
    embedDiagram:       params["embedDiagram"]        !== false,
    contentCompression: (params["contentCompression"] as "flate" | "brotli" | undefined) ?? "flate",
    passphrase:         params["passphrase"]          as string | undefined,
    onLog: (m) => logs.push(m),
  });

  // Ensure output directory exists
  const outDir = dirname(outPath);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, result.bytes);

  return {
    outPath,
    strategy:        result.strategy,
    originalSize:    result.originalSize,
    pdfSize:         result.pdfSize,
    entryCount:      result.entryCount,
    textFileCount:   result.textFileCount,
    binaryFileCount: result.binaryFileCount,
    dedupCount:      result.dedupCount,
    excludedCount:   result.excludedCount,
    readableSample:  result.readableSample.slice(0, 2000),
    privateKeyPem:   result.privateKeyPem,
    publicKeyPem:    result.publicKeyPem,
    signatureHex:    result.signatureHex,
    logs,
  };
}

function handleExtract(params: Params): unknown {
  const pdfPath = params["pdfPath"] as string;
  if (!pdfPath) throw new Error("pdfPath is required");

  const pdfBuf  = new Uint8Array(readFileSync(pdfPath));
  const outPath = (params["outPath"] as string | undefined)
    ?? pdfPath.replace(/\.pdf$/i, "") + ".zip";
  const logs: string[] = [];

  const result = extractPolyglot(pdfBuf, {
    canonical:  params["canonical"]  !== false,
    passphrase: params["passphrase"] as string | undefined,
    onLog: (m) => logs.push(m),
  });

  const outDir = dirname(outPath);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, result.bytes);

  return {
    outPath,
    strategy:       result.strategy,
    entryCount:     result.entryCount,
    zipSize:        result.zipSize,
    files:          result.files,
    signatureValid: result.signatureValid,
    logs,
  };
}

function handleVerify(params: Params): unknown {
  const pdfPath = params["pdfPath"] as string;
  if (!pdfPath) throw new Error("pdfPath is required");
  return verifyPolyglot(new Uint8Array(readFileSync(pdfPath)));
}

function handleReadableSample(params: Params): unknown {
  const pdfPath = params["pdfPath"] as string;
  if (!pdfPath) throw new Error("pdfPath is required");
  const n = Math.min(typeof params["n"] === "number" ? params["n"] : 120, 2000);

  const pdfBuf = new Uint8Array(readFileSync(pdfPath));

  // Fast path: read agent-readable text layer directly without extracting the ZIP.
  const refs = findPolyglotRefs(pdfBuf);
  if (!refs) {
    throw new Error(
      "No polyglot manifest found — readable_sample only works with agent-readable strategy. " +
      "Use extract_polyglot for other strategies."
    );
  }

  const pageRefs = findPageContentsRefs(pdfBuf);
  const lines: string[] = [];
  const decoder = new TextDecoder("utf-8");

  for (const pageRef of pageRefs) {
    const contentNum = pageContentsRef(pdfBuf, pageRef);
    if (contentNum === null) continue;
    const streamBytes = readObjectStream(pdfBuf, contentNum);
    const decoded = decoder.decode(streamBytes);
    const tjLines = extractTjLines(decoded);
    for (const line of tjLines) {
      lines.push(decoder.decode(line));
      if (lines.length >= n) break;
    }
    if (lines.length >= n) break;
  }

  return {
    strategy: "agent-readable",
    lineCount: lines.length,
    lines: lines.slice(0, n),
    text: lines.slice(0, n).join("\n"),
  };
}

function handleGetCapabilities(_p: Params): unknown {
  return {
    version: VERSION,
    protocol: "JSON-RPC 2.0",
    transport: "stdio",
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    strategiesCount: listStrategies().length,
    securityNote: "Encrypted strategies require explicit passphrase — no silent default.",
  };
}

// ── Request dispatch ───────────────────────────────────────────────────────

function handleRequest(req: JsonRpcRequest): JsonRpcResponse | null {
  if (req.method === "initialize") {
    return {
      jsonrpc: "2.0", id: req.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "zip-to-pdf-polyglot", version: VERSION },
      },
    };
  }

  if (req.method === "tools/list") {
    return { jsonrpc: "2.0", id: req.id, result: { tools: TOOLS } };
  }

  if (req.method === "tools/call") {
    const p = req.params as { name: string; arguments?: Record<string, unknown> } | undefined;
    if (!p?.name) {
      return {
        jsonrpc: "2.0", id: req.id,
        error: { code: ERR_INVALID_PARAMS, message: "tools/call requires params.name" },
      };
    }
    const args = p.arguments ?? {};
    try {
      let result: unknown;
      switch (p.name) {
        case "list_strategies":   result = handleListStrategies(args); break;
        case "build_polyglot":    result = handleBuild(args);          break;
        case "extract_polyglot":  result = handleExtract(args);        break;
        case "verify_polyglot":   result = handleVerify(args);         break;
        case "readable_sample":   result = handleReadableSample(args); break;
        case "get_capabilities":  result = handleGetCapabilities(args); break;
        default:
          return {
            jsonrpc: "2.0", id: req.id,
            error: { code: ERR_METHOD_NOT_FOUND, message: `Unknown tool: ${p.name}` },
          };
      }
      return {
        jsonrpc: "2.0", id: req.id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0", id: req.id,
        error: { code: ERR_INTERNAL, message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  if (req.method.startsWith("notifications/")) {
    return null; // notifications never get a response
  }

  return {
    jsonrpc: "2.0", id: req.id,
    error: { code: ERR_METHOD_NOT_FOUND, message: `Method not found: ${req.method}` },
  };
}

function send(resp: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(resp) + "\n");
}

function log(...args: unknown[]): void {
  process.stderr.write("[mcp] " + args.join(" ") + "\n");
}

// ── main ───────────────────────────────────────────────────────────────────

function main(): void {
  log(`zip-to-pdf-polyglot MCP server v${VERSION} starting (JSON-RPC 2.0 over stdio)`);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed);
    } catch (err) {
      send({ jsonrpc: "2.0", id: null, error: { code: ERR_PARSE_ERROR, message: "Parse error: " + String(err) } });
      return;
    }
    if (typeof req !== "object" || req === null || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      send({ jsonrpc: "2.0", id: null, error: { code: ERR_INVALID_REQUEST, message: "Invalid JSON-RPC 2.0 request." } });
      return;
    }
    const resp = handleRequest(req);
    if (resp) send(resp);
  });

  rl.on("close", () => { log("stdin closed — shutting down."); process.exit(0); });
  process.stdin.on("error", (e) => { log("stdin error:", e); process.exit(1); });
}

main();
