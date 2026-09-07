#!/usr/bin/env node
// cli.ts — zip2pdf command-line interface for zip-to-pdf-polyglot v9.1.0
//
// Usage:
//   zip2pdf build <zip> [-s strategy] [-o out.pdf] [--passphrase <pass>]
//                       [--minimal] [--no-font] [--no-diagram] [--brotli]
//                       [--no-exclude-cruft] [--json]
//   zip2pdf extract <pdf> [-o out.zip] [--no-canonical] [--passphrase <pass>] [--json]
//   zip2pdf verify <pdf> [--json]
//   zip2pdf readable <pdf> [-n lines] [--json]
//   zip2pdf inspect <pdf> [--json]
//   zip2pdf bootstrap <pdf> [--json]
//   zip2pdf --list-strategies [--json]
//   zip2pdf --version

import { readFileSync, writeFileSync } from "node:fs";
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
} from "./src/index";
import type { FullManifest, StrategyName } from "./src/types";

const VERSION = "9.1.0";

function usage(): never {
  process.stderr.write(`zip2pdf v${VERSION} — zip-to-pdf-polyglot

Usage:
  zip2pdf build <zip>    [-s strategy] [-o out.pdf] [--passphrase <pass>]
                         [--minimal] [--no-font] [--no-diagram] [--brotli]
                         [--no-exclude-cruft] [--json]
  zip2pdf extract <pdf>  [-o out.zip] [--passphrase <pass>] [--no-canonical] [--json]
  zip2pdf verify <pdf>   [--json]
  zip2pdf readable <pdf> [-n lines] [--json]   Read agent-readable text layer
  zip2pdf inspect <pdf>  [--json]              Print the manifest JSON
  zip2pdf bootstrap <pdf>[--json]              Print Module OS bootstrap package
  zip2pdf --list-strategies [--json]
  zip2pdf --version | -v

Strategies (10 available):
  agent-readable          Full text layer + deduped binary + Module OS (default)
  raw-polyglot-patched    Directly unzippable (unzip works on the PDF)
  raw-polyglot-unpatched  PDF prefix + untouched ZIP bytes
  pdf-attachment          Spec-compliant /EmbeddedFile attachment
  xmp-embedded            Base64 ZIP in XMP metadata stream
  portfolio               PDF Portfolio /Collection with ZIP attachment
  raw-polyglot-signed     Patched polyglot + SHA-256 integrity hash
  encrypted               AES-256-GCM + PBKDF2-SHA256 (needs --passphrase)
  chacha20-poly1305       ChaCha20-Poly1305 + PBKDF2 (needs --passphrase)
  rsa-signed              RSA-2048 asymmetric signature embedded in PDF

Exit codes: 0=success, 1=error
`);
  process.exit(1);
}

interface ParsedArgs {
  file?: string;
  strategy?: string;
  out?: string;
  excludeCruft: boolean;
  canonical: boolean;
  json: boolean;
  n: number;
  minimal: boolean;
  noFont: boolean;
  noDiagram: boolean;
  brotli: boolean;
  passphrase?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    excludeCruft: true,
    canonical: true,
    json: false,
    n: 120,
    minimal: false,
    noFont: false,
    noDiagram: false,
    brotli: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "-s" || a === "--strategy") && argv[i + 1]) out.strategy = argv[++i];
    else if ((a === "-o" || a === "--out") && argv[i + 1]) out.out = argv[++i];
    else if (a === "-n" && argv[i + 1]) out.n = parseInt(argv[++i] ?? "120", 10);
    else if (a === "--no-exclude-cruft") out.excludeCruft = false;
    else if (a === "--no-canonical") out.canonical = false;
    else if (a === "--json") out.json = true;
    else if (a === "--minimal") { out.minimal = true; out.noFont = true; out.noDiagram = true; }
    else if (a === "--no-font") out.noFont = true;
    else if (a === "--no-diagram") out.noDiagram = true;
    else if (a === "--brotli") out.brotli = true;
    else if ((a === "--passphrase" || a === "-p") && argv[i + 1]) out.passphrase = argv[++i];
    else if (!a.startsWith("-") && !out.file) out.file = a;
  }
  return out;
}

function die(msg: string, json: boolean): never {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
  } else {
    process.stderr.write("Error: " + msg + "\n");
  }
  process.exit(1);
}

function info(msg: string, json: boolean): void {
  if (!json) process.stderr.write(msg + "\n");
}

function fmt(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ── build ──────────────────────────────────────────────────────────────────

function cmdBuild(opts: ParsedArgs): void {
  const zipPath = opts.file;
  if (!zipPath) die("No input ZIP file specified.", opts.json);

  const zipBuf = new Uint8Array(readFileSync(zipPath));
  const origName = zipPath.split(/[\\/]/).pop() ?? "archive.zip";
  const strategy = (opts.strategy ?? "agent-readable") as StrategyName;
  const logs: string[] = [];

  // Warn early about missing passphrase before starting expensive operations
  const needsPass = strategy === "encrypted" || strategy === "chacha20-poly1305";
  if (needsPass && !opts.passphrase) {
    die(`Strategy "${strategy}" requires --passphrase <pass>.`, opts.json);
  }

  info(`Building polyglot PDF (strategy: ${strategy})…`, opts.json);

  const result = buildPolyglot(zipBuf, origName, {
    strategy,
    excludeCruft: opts.excludeCruft,
    embedFont: !opts.noFont,
    embedDiagram: !opts.noDiagram,
    contentCompression: opts.brotli ? "brotli" : "flate",
    passphrase: opts.passphrase,
    onLog: (m) => {
      logs.push(m);
      info("  " + m, opts.json);
    },
  });

  const outPath = opts.out ?? zipPath.replace(/\.zip$/i, ".polyglot.pdf");
  writeFileSync(outPath, result.bytes);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      ok: true,
      strategy:        result.strategy,
      outPath,
      originalSize:    result.originalSize,
      pdfSize:         result.pdfSize,
      entryCount:      result.entryCount,
      textFileCount:   result.textFileCount,
      binaryFileCount: result.binaryFileCount,
      dedupCount:      result.dedupCount,
      excludedCount:   result.excludedCount,
      privateKeyPem:   result.privateKeyPem,
      publicKeyPem:    result.publicKeyPem,
      signatureHex:    result.signatureHex,
      logs,
    }) + "\n");
  } else {
    process.stdout.write(`\n✓ Written: ${outPath}\n`);
    process.stdout.write(`  Strategy:       ${result.strategy}\n`);
    process.stdout.write(`  Entries:        ${result.entryCount} (${result.textFileCount} text, ${result.binaryFileCount} binary)\n`);
    process.stdout.write(`  Original size:  ${fmt(result.originalSize)}\n`);
    process.stdout.write(`  PDF size:       ${fmt(result.pdfSize)}\n`);
    if (result.dedupCount > 0)
      process.stdout.write(`  Deduped files:  ${result.dedupCount}\n`);
    if (result.excludedCount > 0)
      process.stdout.write(`  Excluded cruft: ${result.excludedCount}\n`);
    if (result.privateKeyPem) {
      process.stdout.write(`\n  ⚠  RSA Private Key (keep safe — NOT stored in PDF):\n`);
      process.stdout.write(result.privateKeyPem + "\n");
    }
  }
}

// ── extract ────────────────────────────────────────────────────────────────

function cmdExtract(opts: ParsedArgs): void {
  const pdfPath = opts.file;
  if (!pdfPath) die("No input PDF file specified.", opts.json);

  const pdfBuf = new Uint8Array(readFileSync(pdfPath));
  const logs: string[] = [];

  info(`Extracting ZIP from polyglot PDF…`, opts.json);

  const result = extractPolyglot(pdfBuf, {
    canonical: opts.canonical,
    passphrase: opts.passphrase,
    onLog: (m) => {
      logs.push(m);
      info("  " + m, opts.json);
    },
  });

  const outPath = opts.out ?? pdfPath.replace(/\.pdf$/i, ".zip");
  writeFileSync(outPath, result.bytes);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      ok: true,
      strategy:       result.strategy,
      outPath,
      entryCount:     result.entryCount,
      zipSize:        result.zipSize,
      files:          result.files,
      signatureValid: result.signatureValid,
      logs,
    }) + "\n");
  } else {
    process.stdout.write(`\n✓ Extracted: ${outPath}\n`);
    process.stdout.write(`  Strategy:  ${result.strategy}\n`);
    process.stdout.write(`  Entries:   ${result.entryCount}\n`);
    process.stdout.write(`  ZIP size:  ${fmt(result.zipSize)}\n`);
    if (result.signatureValid !== undefined)
      process.stdout.write(`  RSA sig:   ${result.signatureValid ? "VALID ✓" : "INVALID ✗"}\n`);
  }
}

// ── verify ─────────────────────────────────────────────────────────────────

function cmdVerify(opts: ParsedArgs): void {
  const pdfPath = opts.file;
  if (!pdfPath) die("No input PDF file specified.", opts.json);

  const pdfBuf = new Uint8Array(readFileSync(pdfPath));
  const report = verifyPolyglot(pdfBuf);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: true, ...report }) + "\n");
  } else {
    process.stdout.write(`PDF magic:   ${report.pdfMagic ? "✓" : "✗"}\n`);
    process.stdout.write(`Recognized:  ${report.recognized ? "✓" : "✗"}\n`);
    if (report.strategy) process.stdout.write(`Strategy:    ${report.strategy}\n`);
    if (report.entryCount !== null) process.stdout.write(`Entries:     ${report.entryCount}\n`);
    if (report.errors.length > 0)
      process.stdout.write(`Errors:\n${report.errors.map((e) => "  " + e).join("\n")}\n`);
    if (report.strategy === "encrypted" || report.strategy === "chacha20-poly1305")
      process.stdout.write(`Note:        File is encrypted — use extract --passphrase to get entry count.\n`);
  }

  if (!report.recognized) process.exit(1);
}

// ── readable ───────────────────────────────────────────────────────────────

function cmdReadable(opts: ParsedArgs): void {
  const pdfPath = opts.file;
  if (!pdfPath) die("No input PDF file specified.", opts.json);

  const pdfBuf = new Uint8Array(readFileSync(pdfPath));

  // Fast path: agent-readable text layer directly (no ZIP extraction needed)
  const refs = findPolyglotRefs(pdfBuf);
  if (!refs) die("No polyglot manifest found in this PDF (agent-readable strategy required).", opts.json);

  // findPageContentsRefs takes only buf — it reads /Pages from object 2
  const pageRefs = findPageContentsRefs(pdfBuf);
  const lines: string[] = [];
  const decoder = new TextDecoder("utf-8");

  for (const contentsRef of pageRefs) {
    const contentNum = pageContentsRef(pdfBuf, contentsRef);
    if (contentNum === null) continue;
    const streamBytes = readObjectStream(pdfBuf, contentNum);
    const decoded = decoder.decode(streamBytes);
    const tjLines = extractTjLines(decoded);
    for (const line of tjLines) {
      lines.push(decoder.decode(line));
      if (lines.length >= opts.n) break;
    }
    if (lines.length >= opts.n) break;
  }

  const sample = lines.slice(0, opts.n).join("\n");

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: true, lines: lines.slice(0, opts.n), lineCount: lines.length }) + "\n");
  } else {
    process.stdout.write(sample + "\n");
  }
}

// ── inspect ────────────────────────────────────────────────────────────────

function cmdInspect(opts: ParsedArgs): void {
  const pdfPath = opts.file;
  if (!pdfPath) die("No input PDF file specified.", opts.json);

  const pdfBuf = new Uint8Array(readFileSync(pdfPath));
  const refs = findPolyglotRefs(pdfBuf);
  if (!refs) die("No polyglot manifest found in this PDF (agent-readable strategy required).", opts.json);

  const manifestBytes = readObjectStream(pdfBuf, refs.manifestNum);
  const manifest: FullManifest = JSON.parse(new TextDecoder("utf-8").decode(manifestBytes));

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: true, manifest }) + "\n");
  } else {
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
  }
}

// ── bootstrap ──────────────────────────────────────────────────────────────

function cmdBootstrap(opts: ParsedArgs): void {
  const pdfPath = opts.file;
  if (!pdfPath) die("No input PDF file specified.", opts.json);

  const pdfBuf = new Uint8Array(readFileSync(pdfPath));
  const refs = findPolyglotRefs(pdfBuf);
  if (!refs) die("No polyglot manifest found in this PDF (agent-readable strategy required).", opts.json);

  const manifestBytes = readObjectStream(pdfBuf, refs.manifestNum);
  const manifest: FullManifest = JSON.parse(new TextDecoder("utf-8").decode(manifestBytes));
  const ap = manifest.agentProtocol;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: true, agentProtocol: ap, moduleManifest: ap?.moduleManifest }) + "\n");
  } else if (ap) {
    process.stdout.write("=== System Prompt ===\n");
    process.stdout.write((ap.systemPrompt ?? "(none)") + "\n\n");
    process.stdout.write("=== Suggested Actions ===\n");
    for (const step of ap.suggestedActions ?? []) {
      process.stdout.write("  " + step + "\n");
    }
    process.stdout.write("\n=== Available Modules ===\n");
    for (const m of ap.moduleManifest?.modules ?? []) {
      process.stdout.write(`  [${m.id}] ${m.name}\n`);
    }
  } else {
    process.stdout.write("No agent protocol embedded in this PDF.\n");
  }
}

// ── main ───────────────────────────────────────────────────────────────────

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage();

  if (argv[0] === "--list-strategies") {
    const json = argv.includes("--json");
    const strategies = listStrategies();
    if (json) {
      process.stdout.write(JSON.stringify(strategies) + "\n");
    } else {
      process.stdout.write(`\nzip2pdf v${VERSION} — Available strategies:\n\n`);
      for (const s of strategies) {
        const badge = s.badge ? ` [${s.badge}]` : "";
        const lock = s.requiresPassphrase ? " (requires --passphrase)" : "";
        process.stdout.write(`  ${s.name.padEnd(26)} ${s.label}${badge}${lock}\n`);
      }
      process.stdout.write("\n");
    }
    process.exit(0);
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`zip2pdf v${VERSION}\n`);
    process.exit(0);
  }

  const cmd = argv[0];
  const rest = argv.slice(1);

  if      (cmd === "build")     cmdBuild(parseArgs(rest));
  else if (cmd === "extract")   cmdExtract(parseArgs(rest));
  else if (cmd === "verify")    cmdVerify(parseArgs(rest));
  else if (cmd === "readable")  cmdReadable(parseArgs(rest));
  else if (cmd === "inspect")   cmdInspect(parseArgs(rest));
  else if (cmd === "bootstrap") cmdBootstrap(parseArgs(rest));
  else if (argv[0].startsWith("-")) usage();
  else {
    // Shorthand: zip2pdf <file.zip>
    const opts = parseArgs(argv);
    if (!opts.file) usage();
    cmdBuild(opts);
  }
}

main();
