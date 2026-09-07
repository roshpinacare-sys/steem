// server/index.ts — HTTP API server for zip-to-pdf-polyglot v9.1.0
//
// Uses Express + Multer for correct multipart/form-data parsing.
// Pure-Node multipart parsing was replaced because binary file data
// can accidentally match field-name patterns and corrupt option values.
//
// Start: npm run serve   OR   npx tsx server/index.ts
// Default port: 3000 (override with PORT env var)
//
// Endpoints:
//   GET  /                   → Polyglot Studio web UI
//   GET  /api/strategies     → list all 10 strategies
//   GET  /api/info           → version + limits
//   POST /api/build          → ZIP → polyglot PDF  (multipart: file + options)
//   POST /api/extract        → PDF → ZIP           (multipart: file + passphrase)
//   POST /api/verify         → structural check    (multipart: file)
//   POST /api/stats          → file statistics     (multipart: file)
//   POST /api/readable       → text layer preview  (multipart: file)

import express, { Request, Response } from "express";
import multer from "multer";
import cors from "cors";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildPolyglot,
  extractPolyglot,
  verifyPolyglot,
  listStrategies,
} from "../src/index";
import type { StrategyName } from "../src/types";

const PORT  = parseInt(process.env["PORT"] ?? "3000", 10);
const ROOT  = join(__dirname, "..");
const MAX_UPLOAD = 100 * 1024 * 1024; // 100 MB (SEC-06)

// ── middleware ─────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Multer: memory storage, enforced size limit.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD },
});

// ── helpers ────────────────────────────────────────────────────────────────

/** Node-native base64 — avoids btoa (browser-only) and stack-overflow risks. */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function ok(res: Response, body: object): void {
  res.json({ ok: true, ...body });
}

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ ok: false, error: message });
}

// ── static UI ──────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  const uiPath = join(ROOT, "web", "index.html");
  if (existsSync(uiPath)) {
    res.sendFile(uiPath);
  } else {
    res.json({ ok: true, message: "zip-to-pdf-polyglot v9.1.0 API server. GET /api/info for details." });
  }
});

// ── GET /api/strategies ────────────────────────────────────────────────────

app.get("/api/strategies", (_req, res) => {
  ok(res, { strategies: listStrategies() });
});

// ── GET /api/info ──────────────────────────────────────────────────────────

app.get("/api/info", (_req, res) => {
  ok(res, {
    version: "9.1.0",
    maxUploadBytes: MAX_UPLOAD,
    strategiesCount: listStrategies().length,
    endpoints: [
      "GET  /api/strategies",
      "GET  /api/info",
      "POST /api/build    — multipart: file (ZIP) + strategy + passphrase + embedFont + embedDiagram + excludeCruft + contentCompression",
      "POST /api/extract  — multipart: file (PDF) + passphrase",
      "POST /api/verify   — multipart: file (PDF)",
      "POST /api/stats    — multipart: file (PDF)",
      "POST /api/readable — multipart: file (PDF)",
    ],
  });
});

// ── POST /api/build ────────────────────────────────────────────────────────

app.post("/api/build", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) { fail(res, 400, "Missing file field (multipart/form-data with a .zip required)."); return; }

  const strategy      = (req.body["strategy"]            ?? "agent-readable") as StrategyName;
  const passphrase    = req.body["passphrase"]            ?? undefined;
  const excludeCruft  = req.body["excludeCruft"]          !== "false";
  const embedFont     = req.body["embedFont"]             !== "false";
  const embedDiagram  = req.body["embedDiagram"]          !== "false";
  const contentComp   = (req.body["contentCompression"]   ?? "flate") as "flate" | "brotli";

  const logs: string[] = [];
  try {
    const result = buildPolyglot(new Uint8Array(req.file.buffer), req.file.originalname, {
      strategy,
      excludeCruft,
      embedFont,
      embedDiagram,
      contentCompression: contentComp,
      passphrase,
      onLog: (m) => logs.push(m),
    });

    ok(res, {
      strategy:        result.strategy,
      originalSize:    result.originalSize,
      pdfSize:         result.pdfSize,
      entryCount:      result.entryCount,
      textFileCount:   result.textFileCount,
      binaryFileCount: result.binaryFileCount,
      dedupCount:      result.dedupCount,
      excludedCount:   result.excludedCount,
      readableSample:  result.readableSample.slice(0, 3000),
      manifestSummary: result.manifestSummary,
      pdfBase64:       toBase64(result.bytes),
      fileName:        req.file.originalname.replace(/\.zip$/i, "") + ".polyglot.pdf",
      privateKeyPem:   result.privateKeyPem,
      publicKeyPem:    result.publicKeyPem,
      signatureHex:    result.signatureHex,
      logs:            logs.slice(0, 100),
    });
  } catch (err) {
    fail(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── POST /api/extract ──────────────────────────────────────────────────────

app.post("/api/extract", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) { fail(res, 400, "Missing file field (PDF required)."); return; }

  const passphrase = req.body["passphrase"] ?? undefined;
  const logs: string[] = [];

  try {
    const result = extractPolyglot(new Uint8Array(req.file.buffer), {
      passphrase,
      onLog: (m) => logs.push(m),
    });

    ok(res, {
      strategy:       result.strategy,
      entryCount:     result.entryCount,
      zipSize:        result.zipSize,
      files:          result.files,
      signatureValid: result.signatureValid,
      zipBase64:      toBase64(result.bytes),
      logs:           logs.slice(0, 100),
    });
  } catch (err) {
    fail(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── POST /api/verify ───────────────────────────────────────────────────────

app.post("/api/verify", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) { fail(res, 400, "Missing file field (PDF required)."); return; }

  try {
    const report = verifyPolyglot(new Uint8Array(req.file.buffer));
    ok(res, report as unknown as object);
  } catch (err) {
    fail(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── POST /api/stats ────────────────────────────────────────────────────────

app.post("/api/stats", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) { fail(res, 400, "Missing file field (PDF required)."); return; }

  const passphrase = req.body["passphrase"] ?? undefined;

  try {
    const pdfBuf = new Uint8Array(req.file.buffer);
    const report = verifyPolyglot(pdfBuf);

    if (!report.recognized) {
      fail(res, 422, "PDF not recognized as a valid polyglot file.");
      return;
    }

    // Only attempt extraction for non-encrypted strategies when no passphrase given
    const isEncrypted = report.strategy === "encrypted" || report.strategy === "chacha20-poly1305";
    if (isEncrypted && !passphrase) {
      ok(res, {
        recognized:  true,
        strategy:    report.strategy,
        entryCount:  null,
        note:        "File is encrypted. Provide passphrase to get full stats.",
        pdfSize:     pdfBuf.length,
      });
      return;
    }

    const extracted = extractPolyglot(pdfBuf, { passphrase });
    const extMap: Record<string, number> = {};
    for (const f of extracted.files) {
      const parts = f.name.split(".");
      const ext = parts.length > 1 ? (parts.pop()!.toLowerCase()) : "(no ext)";
      extMap[ext] = (extMap[ext] ?? 0) + 1;
    }
    const topExtensions = Object.entries(extMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([ext, count]) => ({ ext, count }));

    ok(res, {
      entryCount:          extracted.entryCount,
      textFileCount:       extracted.files.filter((f) => f.type === "text").length,
      binaryFileCount:     extracted.files.filter((f) => f.type === "binary").length,
      totalOriginalBytes:  extracted.files.reduce((s, f) => s + f.size, 0),
      zipSize:             extracted.zipSize,
      pdfSize:             pdfBuf.length,
      strategy:            report.strategy,
      topExtensions,
      files:               extracted.files,
    });
  } catch (err) {
    fail(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── POST /api/readable ─────────────────────────────────────────────────────

app.post("/api/readable", upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) { fail(res, 400, "Missing file field (PDF required)."); return; }

  const passphrase = req.body["passphrase"] ?? undefined;

  try {
    const pdfBuf = new Uint8Array(req.file.buffer);
    const report = verifyPolyglot(pdfBuf);

    if (!report.recognized) {
      fail(res, 422, "PDF not recognized as a valid polyglot file.");
      return;
    }

    const extracted = extractPolyglot(pdfBuf, { passphrase });
    const sample = extracted.files
      .filter((f) => f.type === "text")
      .slice(0, 10)
      .map((f) => ({ name: f.name, size: f.size }));

    ok(res, {
      strategy:    extracted.strategy,
      entryCount:  extracted.entryCount,
      textFiles:   sample,
    });
  } catch (err) {
    fail(res, 500, err instanceof Error ? err.message : String(err));
  }
});

// ── start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nzip-to-pdf-polyglot v9.1.0 HTTP server`);
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  http://localhost:${PORT}/               Polyglot Studio UI`);
  console.log(`  GET  http://localhost:${PORT}/api/info       Server info`);
  console.log(`  GET  http://localhost:${PORT}/api/strategies`);
  console.log(`  POST http://localhost:${PORT}/api/build`);
  console.log(`  POST http://localhost:${PORT}/api/extract`);
  console.log(`  POST http://localhost:${PORT}/api/verify`);
  console.log(`  POST http://localhost:${PORT}/api/stats`);
  console.log(`\nPress Ctrl+C to stop.\n`);
});
