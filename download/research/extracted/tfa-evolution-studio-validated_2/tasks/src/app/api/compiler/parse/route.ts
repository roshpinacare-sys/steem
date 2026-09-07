// ============================================================================
// TFA Evolution Studio v16 — POST /api/compiler/parse
//
// Accepts a multipart form upload with field "zip" (the project ZIP file).
// Extracts it to a temp directory, parses it into a ProjectIR, and returns
// the IR (without the raw file list for payload efficiency).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { parseZipToIR } from "@/lib/compiler/project-ir";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData();
    const file = formData.get("zip");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'zip' field in form data" }, { status: 400 });
    }

    if (!file.name.endsWith(".zip")) {
      return NextResponse.json({ error: "Only .zip files are supported" }, { status: 400 });
    }

    const maxMB = 250;
    if (file.size > maxMB * 1024 * 1024) {
      return NextResponse.json({ error: `ZIP too large (max ${maxMB} MB)` }, { status: 413 });
    }

    // Write the uploaded ZIP to a temp file
    const tmpDir = path.join(os.tmpdir(), `tfa-parse-${uuidv4().slice(0, 8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const zipPath = path.join(tmpDir, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(zipPath, buffer);

    const extractDir = path.join(tmpDir, "extracted");

    const ir = parseZipToIR(zipPath, extractDir);

    // Return IR summary — omit `files` array (can be thousands of entries)
    const { files: _files, rootDir: _root, ...irSummary } = ir;

    // Cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      ir: irSummary,
      fileCount: _files.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Parse failed: ${message}` }, { status: 500 });
  }
}
