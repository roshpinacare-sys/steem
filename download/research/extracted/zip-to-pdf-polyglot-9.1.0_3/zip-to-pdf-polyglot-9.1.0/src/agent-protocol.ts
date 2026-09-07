// src/agent-protocol.ts
//
// v5.0: Module OS — the PDF is a self-describing, self-executing agent artifact.
//
// The PDF carries:
//   1. MODULE MANIFEST — a structured capability registry that tells any agent
//      what modules this PDF provides, what they require, and how to invoke them.
//      This is the "OS" layer: modules are not code files — they are capability
//      declarations that augment the agent's own abilities beyond its defaults.
//   2. AGENT PROTOCOL — a system prompt + typed tool definitions (JSON Schema)
//      so any LLM that receives this PDF can immediately drive it end-to-end
//      without external documentation.
//   3. PDF INTERACTIVE BUTTONS — AcroForm widgets that provide real instructions
//      (not just alerts) when clicked in a PDF viewer.
//
// WHAT IS A MODULE OS?
//
// When an agent receives this PDF, it gains capabilities it didn't have before:
//  - SEARCH: full-text search over the entire codebase without extracting
//  - EXECUTE: a verified build/test pipeline it can run step-by-step
//  - VERIFY: cryptographic integrity check (Merkle root) — trust without server
//  - MEMORY: persistent state the agent updates and re-embeds on next save
//  - SKILLS: reusable prompt templates / instruction sets the agent can invoke
//
// These are real, executable capabilities backed by the /api/* endpoints and CLI.
// The agent doesn't need external tools — it needs only the PDF and the server.

import { dictObject } from "./pdf-writer";
import type { AgentProtocol, AgentToolDef, JsAction } from "./types";

// ---------------------------------------------------------------------------
// Module OS — capability registry
// ---------------------------------------------------------------------------

export interface ModuleCapability {
  /** Machine-readable module identifier. */
  id: string;
  /** Human/agent-readable name. */
  name: string;
  /** What the agent gains by invoking this module. */
  description: string;
  /** How to invoke it: CLI command or API endpoint. */
  invoke: {
    cli?: string;          // e.g. "zip2pdf readable <pdf>"
    api?: string;          // e.g. "POST /api/preview"
    method?: string;       // HTTP method
    inputSchema?: Record<string, unknown>; // JSON Schema for API body
  };
  /** Whether this module requires a running server. */
  requiresServer: boolean;
  /** Whether this module works offline (CLI only). */
  offlineCapable: boolean;
}

export interface ModuleManifest {
  version: "5.0";
  description: string;
  modules: ModuleCapability[];
  /** How to bootstrap: steps an agent should follow on first encounter. */
  bootstrap: string[];
  /** Quick-start system prompt for embedding in a chat/agent context. */
  systemPrompt: string;
}

/**
 * Build the Module OS manifest — a structured registry of capabilities this
 * PDF provides to any agent that reads it.
 */
export function buildModuleManifest(
  origName: string,
  fileCount: number,
  textFileCount: number,
  binaryFileCount: number,
  hasMerkle: boolean,
  hasTests: boolean,
  hasPipeline: boolean,
  apiBase = ""
): ModuleManifest {
  const modules: ModuleCapability[] = [
    {
      id: "extract",
      name: "Extract Source Code",
      description:
        `Recover the complete canonical ZIP from this PDF. Returns ${fileCount} files ` +
        `(${textFileCount} text, ${binaryFileCount} binary) in a deterministic, ` +
        `byte-exact archive. You gain access to the full source tree.`,
      invoke: {
        cli: `zip2pdf extract <pdf> -o recovered.zip`,
        api: `${apiBase}/api/extract`,
        method: "POST",
        inputSchema: {
          type: "object",
          properties: {
            canonical: { type: "boolean", description: "Produce canonical (sorted, fixed timestamps) ZIP", default: true },
          },
        },
      },
      requiresServer: false,
      offlineCapable: true,
    },
    {
      id: "search",
      name: "Search Codebase",
      description:
        "Full-text search over the agent-readable text layer WITHOUT extracting. " +
        "Grep patterns, file extensions, function names — all queryable directly from the PDF. " +
        "You gain codebase search without a checkout.",
      invoke: {
        api: `${apiBase}/api/search`,
        method: "POST",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", description: "Search string or regex pattern" },
            maxResults: { type: "integer", default: 50 },
            caseSensitive: { type: "boolean", default: false },
          },
        },
      },
      requiresServer: true,
      offlineCapable: false,
    },
    {
      id: "preview",
      name: "Read Text Layer",
      description:
        "Read the agent-readable text layer (all source files concatenated with file headers). " +
        "Equivalent to pdftotext but uses the toolkit's own reader — no external dependency. " +
        "You gain a complete view of the codebase in one call.",
      invoke: {
        cli: `zip2pdf readable <pdf> -n 1000000`,
        api: `${apiBase}/api/preview`,
        method: "POST",
        inputSchema: {
          type: "object",
          properties: {
            lines: { type: "integer", description: "Max lines to return (0 = all)", default: 500 },
          },
        },
      },
      requiresServer: false,
      offlineCapable: true,
    },
    {
      id: "inspect",
      name: "Inspect Manifest",
      description:
        "Read the full JSON manifest: file list with SHA-256 hashes, line ranges, " +
        "dedup statistics, Merkle root, embedded tests, and build pipeline. " +
        "You gain a structured inventory of the archive without decompressing it.",
      invoke: {
        api: `${apiBase}/api/inspect`,
        method: "POST",
      },
      requiresServer: true,
      offlineCapable: false,
    },
    ...(hasMerkle
      ? [
          {
            id: "verify-integrity",
            name: "Verify Integrity (Trustless)",
            description:
              "Verify the Merkle integrity root — a SHA-256 tree over all file hashes. " +
              "Detects any corruption or tampering without trusting the server. " +
              "You gain trustless verification of the entire archive.",
            invoke: {
              api: `${apiBase}/api/verify-integrity`,
              method: "POST",
            },
            requiresServer: true,
            offlineCapable: false,
          } satisfies ModuleCapability,
        ]
      : []),
    ...(hasTests
      ? [
          {
            id: "run-tests",
            name: "Run Embedded Test Suite",
            description:
              "Execute the embedded SHA-256 test assertions after extraction. " +
              "Each test verifies a specific file's hash, confirming lossless recovery. " +
              "You gain automated correctness verification.",
            invoke: {
              api: `${apiBase}/api/run-tool`,
              method: "POST",
              inputSchema: {
                type: "object",
                required: ["tool"],
                properties: { tool: { type: "string", enum: ["run-tests"] } },
              },
            },
            requiresServer: true,
            offlineCapable: false,
          } satisfies ModuleCapability,
        ]
      : []),
    ...(hasPipeline
      ? [
          {
            id: "execute-pipeline",
            name: "Execute Build Pipeline",
            description:
              "Run the auto-detected build pipeline (install → build → test) after extraction. " +
              "Steps are project-specific (npm, cargo, make, etc.). " +
              "You gain the ability to build and test the project end-to-end.",
            invoke: {
              api: `${apiBase}/api/run-tool`,
              method: "POST",
              inputSchema: {
                type: "object",
                required: ["tool"],
                properties: { tool: { type: "string", enum: ["execute-pipeline"] } },
              },
            },
            requiresServer: true,
            offlineCapable: false,
          } satisfies ModuleCapability,
        ]
      : []),
    {
      id: "stats",
      name: "Archive Statistics",
      description:
        "File type breakdown, extension counts, size distribution, dedup savings. " +
        "You gain a quantitative overview of the codebase structure.",
      invoke: {
        api: `${apiBase}/api/stats`,
        method: "POST",
      },
      requiresServer: true,
      offlineCapable: false,
    },
    {
      id: "tree",
      name: "File Tree",
      description:
        "ASCII directory tree of the archive — identical to `find . | sort`. " +
        "You gain structural navigation without extracting.",
      invoke: {
        api: `${apiBase}/api/tree`,
        method: "POST",
      },
      requiresServer: true,
      offlineCapable: false,
    },
  ];

  const bootstrap: string[] = [
    `Step 1 — Orient: call 'inspect' to read the manifest (file list, SHA hashes, pipeline).`,
    `Step 2 — Browse: call 'preview' with lines=200 to see the first 200 lines of source code.`,
    `Step 3 — Search: use 'search' to find specific functions, files, or patterns.`,
    ...(hasMerkle ? [`Step 4 — Trust: call 'verify-integrity' to confirm the archive is uncorrupted.`] : []),
    `Step ${hasMerkle ? 5 : 4} — Extract: call 'extract' to recover the canonical ZIP when you need the full source.`,
    ...(hasPipeline
      ? [`Step ${hasMerkle ? 6 : 5} — Execute: after extraction, run 'execute-pipeline' to build and test the project.`]
      : []),
  ];

  const systemPrompt =
    `You have received a zip-to-pdf-polyglot v5.0 Module OS document.\n` +
    `This PDF encodes "${origName}" (${fileCount} files: ${textFileCount} text, ${binaryFileCount} binary).\n\n` +
    `WHAT YOU CAN DO (modules available in this PDF):\n` +
    modules.map((m) => `  [${m.id}] ${m.name}: ${m.description}`).join("\n") +
    `\n\nHOW TO START:\n` +
    bootstrap.map((s, i) => `  ${s}`).join("\n") +
    `\n\nThe text layer is directly readable: call the 'preview' module or run ` +
    `\`pdftotext <pdf> -\` to see all source code. No extraction required for browsing.`;

  return {
    version: "5.0",
    description: `Module OS manifest for "${origName}" — ${fileCount} files, ${modules.length} modules`,
    modules,
    bootstrap,
    systemPrompt,
  };
}

// ---------------------------------------------------------------------------
// Agent protocol (backward-compatible wrapper around ModuleManifest)
// ---------------------------------------------------------------------------

/**
 * Build the agent protocol for a given archive.  This is the v5 upgrade of
 * the v2.6 AgentProtocol: it now includes the full ModuleManifest (typed
 * capability registry) alongside the system prompt and tool definitions.
 */
export function buildAgentProtocol(
  origName: string,
  fileCount: number,
  hasMerkle: boolean,
  hasTests: boolean,
  hasPipeline: boolean,
  apiBase = "",
  textFileCount = 0,
  binaryFileCount = 0
): AgentProtocol & { moduleManifest: ModuleManifest } {
  const moduleManifest = buildModuleManifest(
    origName,
    fileCount,
    textFileCount,
    binaryFileCount,
    hasMerkle,
    hasTests,
    hasPipeline,
    apiBase
  );

  const tools: AgentToolDef[] = moduleManifest.modules
    .filter((m) => m.invoke.api)
    .map((m) => ({
      name: m.id.replace(/-/g, "_"),
      description: m.description,
      endpoint: m.invoke.api!,
      method: m.invoke.method || "POST",
      exampleArgs: {},
    }));

  return {
    systemPrompt: moduleManifest.systemPrompt,
    tools,
    suggestedActions: moduleManifest.bootstrap,
    apiBase,
    moduleManifest,
  };
}

// ---------------------------------------------------------------------------
// PDF interactive buttons — real instructions, not just alerts
// ---------------------------------------------------------------------------

/**
 * Build JS actions for AcroForm buttons. v5: the buttons display real,
 * actionable instructions rather than simple "POST to /api/..." alerts.
 */
export function buildJsActions(origName: string): JsAction[] {
  const safe = origName.replace(/'/g, "\\'").slice(0, 60);
  return [
    {
      label: "Extract ZIP",
      js: `app.alert("EXTRACT: POST this PDF to /api/extract\\n\\nCLI: zip2pdf extract <pdf> -o recovered.zip\\n\\nReturns base64 ZIP + file list.", 3, 0, "Extract Source Code from ${safe}");`,
    },
    {
      label: "Verify Integrity",
      js: `app.alert("VERIFY: POST this PDF to /api/verify-integrity\\n\\nReturns {verified: true/false, merkleRoot, fileCount}\\n\\nNo server needed for CLI: zip2pdf verify <pdf>", 3, 0, "Verify Integrity of ${safe}");`,
    },
    {
      label: "Inspect Manifest",
      js: `app.alert("INSPECT: POST this PDF to /api/inspect\\n\\nReturns the full JSON manifest:\\n- File list with SHA-256 hashes\\n- Build pipeline steps\\n- Dedup statistics", 3, 0, "Inspect Manifest of ${safe}");`,
    },
    {
      label: "Search Code",
      js: `var q = app.response({cQuestion:"Search query (string or regex):", cTitle:"Search ${safe}", cDefault:""});` +
          `if (q) app.alert("SEARCH: POST to /api/search\\nBody: {query: \\"" + q + "\\", maxResults: 50}\\n\\nOr use preview to read the full text layer.", 3, 0, "Search");`,
    },
  ];
}

/**
 * Build the AcroForm objects for interactive buttons on the cover page.
 */
export function buildAcroFormButtons(
  startNum: number,
  coverPageObjNum: number,
  actions: JsAction[]
): {
  objects: Record<number, Uint8Array>;
  fieldObjNums: number[];
  nextNum: number;
} {
  const objects: Record<number, Uint8Array> = {};
  const fieldObjNums: number[] = [];
  let obj = startNum;
  const btnHeight = 18;
  const btnWidth = 100;
  const startY = 100;
  const startX = 50;
  const gap = 8;

  for (let i = 0; i < actions.length; i++) {
    const fieldNum = obj++;
    const actionNum = obj++;
    const x = startX + i * (btnWidth + gap);
    const y = startY;

    objects[actionNum] = dictObject(
      actionNum,
      `<< /S /JavaScript /JS (${escapeJs(actions[i].js)}) >>`
    );
    objects[fieldNum] = dictObject(
      fieldNum,
      `<< /Type /Annot /Subtype /Widget /FT /Btn /Ff 65536 /T (${escapePdf(actions[i].label)}) ` +
        `/V /Off /P ${coverPageObjNum} 0 R /Rect [${x} ${y} ${x + btnWidth} ${y + btnHeight}] ` +
        `/AA << /E ${actionNum} 0 R >> /MK << /BG [0.85 0.95 0.85] /CA (${escapePdf(actions[i].label)}) >> ` +
        `/DA (/Helv 7 Tf 0 0 0 rg) /AP << /N << /Type /XObject /Subtype /Form /BBox [0 0 ${btnWidth} ${btnHeight}] >> >> >>`
    );
    fieldObjNums.push(fieldNum);
  }

  return { objects, fieldObjNums, nextNum: obj };
}

function escapeJs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function escapePdf(s: string): string {
  return s.replace(/[()\\]/g, "\\$&");
}
