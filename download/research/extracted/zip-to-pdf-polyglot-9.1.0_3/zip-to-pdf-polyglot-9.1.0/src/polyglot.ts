// src/lib/polyglot/polyglot.ts — v8.1
//
// Public facade over the strategy registry.
// v8.1 adds: chacha20-poly1305, rsa-signed strategies.

import { concatBytes, findBytes, fromHex, sanitizeForPdfText, toHex, u16, u32, writeU32 } from "./bytes";
import { findEOCD, readZipStructure, walkCentralDirectory } from "./zip-reader";
import type {
  BuildOptions,
  BuildResult,
  ExtractOptions,
  ExtractResult,
  ManifestSummary,
  StrategyName,
  VerifyReport,
} from "./types";

import * as agentReadable from "./strategies/agent-readable";
import * as rawPolyglotPatched from "./strategies/raw-polyglot-patched";
import * as rawPolyglotUnpatched from "./strategies/raw-polyglot-unpatched";
import * as pdfAttachment from "./strategies/pdf-attachment";
import * as xmpEmbedded from "./strategies/xmp-embedded";
import * as portfolio from "./strategies/portfolio";
import * as rawPolyglotSigned from "./strategies/raw-polyglot-signed";
import * as encrypted from "./strategies/encrypted";
import * as chacha20Poly1305 from "./strategies/chacha20-poly1305";
import * as rsaSigned from "./strategies/rsa-signed";
import {
  buildSharded,
  extractSharded,
  readIndexManifest,
  type ShardedBuildOptions,
  type ShardedBuildResult,
  type ShardedExtractOptions,
  type ShardedExtractResult,
} from "./sharding";

export interface StrategyModule {
  name: StrategyName;
  label: string;
  isTrueByteLevelPolyglot: boolean;
  isExtractable: boolean;
  build: (zipBuf: Uint8Array, origName: string, opts: any) => any;
  extract?: (buf: Uint8Array, opts: any) => any;
}

export const STRATEGIES: Record<StrategyName, StrategyModule> = {
  [agentReadable.name]: agentReadable as unknown as StrategyModule,
  [rawPolyglotPatched.name]: rawPolyglotPatched as unknown as StrategyModule,
  [rawPolyglotUnpatched.name]: rawPolyglotUnpatched as unknown as StrategyModule,
  [pdfAttachment.name]: pdfAttachment as unknown as StrategyModule,
  [xmpEmbedded.name]: xmpEmbedded as unknown as StrategyModule,
  [portfolio.name]: portfolio as unknown as StrategyModule,
  [rawPolyglotSigned.name]: rawPolyglotSigned as unknown as StrategyModule,
  [encrypted.name]: encrypted as unknown as StrategyModule,
  [chacha20Poly1305.name]: chacha20Poly1305 as unknown as StrategyModule,
  [rsaSigned.name]: rsaSigned as unknown as StrategyModule,
};

export const DEFAULT_STRATEGY: StrategyName = "agent-readable";

// Strategy metadata for UI display
const STRATEGY_META: Record<StrategyName, { badge: string; requiresPassphrase: boolean }> = {
  "agent-readable":         { badge: "⭐ Recommended", requiresPassphrase: false },
  "raw-polyglot-patched":   { badge: "True Polyglot",  requiresPassphrase: false },
  "raw-polyglot-unpatched": { badge: "Raw",            requiresPassphrase: false },
  "pdf-attachment":         { badge: "Spec-compliant",  requiresPassphrase: false },
  "xmp-embedded":           { badge: "XMP",            requiresPassphrase: false },
  "portfolio":              { badge: "Portfolio",       requiresPassphrase: false },
  "raw-polyglot-signed":    { badge: "SHA-256 Signed", requiresPassphrase: false },
  "encrypted":              { badge: "🔒 AES-256-GCM", requiresPassphrase: true  },
  "chacha20-poly1305":      { badge: "🔒 ChaCha20",    requiresPassphrase: true  },
  "rsa-signed":             { badge: "🔑 RSA-2048",    requiresPassphrase: false },
};

export function listStrategies() {
  return Object.values(STRATEGIES).map((s) => ({
    name: s.name,
    label: s.label,
    isTrueByteLevelPolyglot: s.isTrueByteLevelPolyglot,
    isExtractable: s.isExtractable,
    requiresPassphrase: STRATEGY_META[s.name]?.requiresPassphrase ?? false,
    badge: STRATEGY_META[s.name]?.badge ?? "",
  }));
}

export function buildPolyglot(
  zipBuf: Uint8Array,
  origName: string,
  opts: BuildOptions = {}
): BuildResult {
  const strategyName = opts.strategy || DEFAULT_STRATEGY;
  const strategy = STRATEGIES[strategyName];
  if (!strategy) {
    throw new Error(
      `Unknown strategy "${strategyName}". Available: ${Object.keys(STRATEGIES).join(", ")}`
    );
  }
  const logs: string[] = [];
  const onLog = (m: string) => {
    logs.push(m);
    opts.onLog?.(m);
  };

  if (strategyName === "agent-readable") {
    const r = agentReadable.build(zipBuf, origName, {
      excludeCruft: opts.excludeCruft,
      embedFont: opts.embedFont,
      contentCompression: opts.contentCompression,
      embedDiagram: opts.embedDiagram,
      onLog,
      onProgress: opts.onProgress,
    });
    return {
      bytes: r.bytes,
      strategy: "agent-readable",
      entryCount: r.entryCount,
      originalSize: r.originalSize,
      pdfSize: r.pdfSize,
      textFileCount: r.textFileCount,
      binaryFileCount: r.binaryFileCount,
      dedupCount: r.dedupCount,
      excludedCount: r.excludedCount,
      readableSample: r.readableSample,
      manifestSummary: r.manifestSummary,
      logs,
    };
  }

  // Encrypted strategies require a passphrase — fail loudly rather than silently using a default.
  if (strategyName === "encrypted" || strategyName === "chacha20-poly1305") {
    if (!opts.passphrase) {
      throw new Error(
        `Strategy "${strategyName}" requires a passphrase. ` +
        `Pass passphrase via --passphrase <pass> (CLI) or opts.passphrase (API). ` +
        `There is no default — a missing passphrase is a security error, not a silent fallback.`
      );
    }
    const r = strategy.build(zipBuf, origName, { onLog, passphrase: opts.passphrase });
    return {
      bytes: r.bytes,
      strategy: strategyName,
      entryCount: r.entryCount,
      originalSize: zipBuf.length,
      pdfSize: r.bytes.length,
      textFileCount: 0,
      binaryFileCount: r.entryCount,
      dedupCount: 0,
      excludedCount: 0,
      readableSample: "",
      manifestSummary: {
        fileCount: r.entryCount,
        textFileCount: 0,
        binaryFileCount: r.entryCount,
        dedupCount: 0,
        excludedCount: 0,
        totalOriginalBytes: zipBuf.length,
      },
      logs,
    };
  }

  // RSA-signed strategy
  if (strategyName === "rsa-signed") {
    const r = rsaSigned.build(zipBuf, origName, {
      onLog,
      privateKeyPem: opts.privateKeyPem,
      publicKeyPem: opts.publicKeyPem,
    });
    return {
      bytes: r.bytes,
      strategy: "rsa-signed",
      entryCount: r.entryCount,
      originalSize: zipBuf.length,
      pdfSize: r.bytes.length,
      textFileCount: 0,
      binaryFileCount: r.entryCount,
      dedupCount: 0,
      excludedCount: 0,
      readableSample: "",
      manifestSummary: {
        fileCount: r.entryCount,
        textFileCount: 0,
        binaryFileCount: r.entryCount,
        dedupCount: 0,
        excludedCount: 0,
        totalOriginalBytes: zipBuf.length,
      },
      logs,
      privateKeyPem: r.privateKeyPem,
      publicKeyPem: r.publicKeyPem,
      signatureHex: r.signatureHex,
    };
  }

  // v1 strategies: normalize into BuildResult.
  const r = strategy.build(zipBuf, origName, { onLog });
  const entryCount: number = r.entryCount ?? 0;

  return {
    bytes: r.bytes,
    strategy: strategyName,
    entryCount,
    originalSize: zipBuf.length,
    pdfSize: r.bytes.length,
    textFileCount: 0,
    binaryFileCount: entryCount,
    dedupCount: 0,
    excludedCount: 0,
    readableSample: "",
    manifestSummary: {
      fileCount: entryCount,
      textFileCount: 0,
      binaryFileCount: entryCount,
      dedupCount: 0,
      excludedCount: 0,
      totalOriginalBytes: zipBuf.length,
    },
    logs,
  };
}

export function extractPolyglot(
  buf: Uint8Array,
  opts: ExtractOptions = {}
): ExtractResult {
  const logs: string[] = [];
  const onLog = (m: string) => {
    logs.push(m);
    opts.onLog?.(m);
  };

  // Auto-detect: try agent-readable first, then others
  const tryOrder: StrategyName[] = opts.strategy
    ? [opts.strategy]
    : [
        "agent-readable",
        "encrypted",
        "chacha20-poly1305",
        "rsa-signed",
        "raw-polyglot-signed",
        "raw-polyglot-patched",
        "raw-polyglot-unpatched",
        "pdf-attachment",
        "xmp-embedded",
        "portfolio",
      ];

  let lastError: Error | null = null;
  for (const stratName of tryOrder) {
    const strat = STRATEGIES[stratName];
    if (!strat?.extract) continue;
    try {
      const extractOpts: any = { onLog, canonical: opts.canonical !== false };
      if (stratName === "encrypted" || stratName === "chacha20-poly1305") {
        if (!opts.passphrase) {
          // Skip passphrase-required strategies during auto-detection if no passphrase supplied.
          // This prevents 600K PBKDF2 iterations on every extraction of a non-encrypted file,
          // and prevents silent use of a default passphrase (security fix).
          lastError = new Error(`Strategy "${stratName}" requires a passphrase.`);
          onLog(`skipping ${stratName}: no passphrase provided`);
          continue;
        }
        extractOpts.passphrase = opts.passphrase;
      }
      const r = strat.extract(buf, extractOpts);
      const bytes: Uint8Array = r.bytes;
      const entryCount: number = r.entryCount ?? 0;
      const files: { name: string; size: number; type: "text" | "binary" }[] =
        r.files ?? [];

      // Build file list from ZIP if not provided
      let fileList = files;
      if (fileList.length === 0 && bytes.length > 0) {
        try {
          const { cdOffset, entryCount: ec } = readZipStructure(bytes);
          for (const entry of walkCentralDirectory(bytes, cdOffset, ec)) {
            if (!entry.isDirectory) {
              fileList.push({ name: entry.name, size: entry.uncompressedSize, type: "binary" });
            }
          }
        } catch { /* best-effort */ }
      }

      return {
        bytes,
        strategy: stratName,
        entryCount,
        zipSize: bytes.length,
        files: fileList,
        logs,
        signatureValid: r.signatureValid,
      };
    } catch (e) {
      lastError = e as Error;
      onLog(`strategy ${stratName} failed: ${(e as Error).message}`);
    }
  }

  throw lastError ?? new Error("Could not extract: no matching strategy found.");
}

export function verifyPolyglot(buf: Uint8Array): VerifyReport {
  const pdfMagic =
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46;

  const errors: string[] = [];
  if (!pdfMagic) errors.push("File does not start with %PDF");

  // Ordered detection — fast-path marker checks first to avoid unnecessary crypto work.
  // IMPORTANT: encrypted/chacha20 strategies use PBKDF2 (600K iterations ≈ 1s CPU).
  // We detect them by marker presence only — NO decryption during verify.
  const ENCRYPTED_MARKER    = new TextEncoder().encode("/PolyglotEncryptedV2");
  const CHACHA_MARKER       = new TextEncoder().encode("/PolyglotChaCha20Poly1305");

  function hasMarker(marker: Uint8Array): boolean {
    outer: for (let i = 0; i <= buf.length - marker.length; i++) {
      for (let j = 0; j < marker.length; j++) {
        if (buf[i + j] !== marker[j]) continue outer;
      }
      return true;
    }
    return false;
  }

  // Check passphrase-encrypted strategies by marker only (no decryption).
  if (hasMarker(ENCRYPTED_MARKER)) {
    return { recognized: true, strategy: "encrypted", entryCount: null, pdfMagic, errors };
  }
  if (hasMarker(CHACHA_MARKER)) {
    return { recognized: true, strategy: "chacha20-poly1305", entryCount: null, pdfMagic, errors };
  }

  // Check non-passphrase strategies via their extract functions (all fast: O(file size) scan).
  const VERIFY_ORDER: StrategyName[] = [
    "agent-readable",
    "rsa-signed",
    "raw-polyglot-signed",
    "raw-polyglot-patched",
    "raw-polyglot-unpatched",
    "pdf-attachment",
    "xmp-embedded",
    "portfolio",
  ];
  for (const stratName of VERIFY_ORDER) {
    const strat = STRATEGIES[stratName];
    if (!strat?.extract) continue;
    try {
      const r = strat.extract(buf, { onLog: () => {} });
      return {
        recognized: true,
        strategy: stratName,
        entryCount: r.entryCount ?? null,
        pdfMagic,
        errors,
      };
    } catch { /* try next */ }
  }

  return {
    recognized: false,
    strategy: null,
    entryCount: null,
    pdfMagic,
    errors: [...errors, "No strategy recognized this file"],
  };
}

export function buildPolyglotSharded(
  zipBuf: Uint8Array,
  origName: string,
  opts: ShardedBuildOptions = {}
): ShardedBuildResult {
  return buildSharded(zipBuf, origName, opts);
}

export function extractPolyglotSharded(
  indexPdf: Uint8Array,
  shardPdfs: Uint8Array[],
  opts: ShardedExtractOptions = {}
): ShardedExtractResult {
  return extractSharded(indexPdf, shardPdfs, opts);
}

// Backward-compatible re-exports
export { findEOCD, u16, u32, writeU32, concatBytes, sanitizeForPdfText, toHex, fromHex, findBytes };
