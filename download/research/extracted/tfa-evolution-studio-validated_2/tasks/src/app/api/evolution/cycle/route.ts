import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { startPipelineCycle, persistPipelineUpload } from "@/lib/engine/pipeline-engine";
import { loadState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const zip = form.get("zip");
    const promptFile = form.get("prompt");
    const promptText = form.get("promptText");
    const parentVersionId = (form.get("parentVersionId") as string) || undefined;

    let zipPath: string;
    let zipName: string;
    if (zip instanceof File) {
      const buf = Buffer.from(await zip.arrayBuffer());
      zipName = zip.name;
      const safeName = zip.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const tmpPath = path.join(os.tmpdir(), `tfa-upload-${uuidv4().slice(0, 8)}-${safeName}`);
      fs.writeFileSync(tmpPath, buf);
      zipPath = persistPipelineUpload("__platform__", tmpPath);
    } else {
      const s = loadState() as { projects: unknown[]; versions: unknown[]; uploadedZip?: { name: string; extractedPath: string } };
      if (!s.uploadedZip)
        return NextResponse.json({ error: "No ZIP provided or previously uploaded." }, { status: 400 });
      zipName = s.uploadedZip.name;
      zipPath = s.uploadedZip.extractedPath;
      if (!fs.existsSync(zipPath))
        return NextResponse.json({ error: "Previously uploaded ZIP no longer exists." }, { status: 400 });
    }

    let text: string;
    let promptName: string;
    if (promptFile instanceof File) {
      text = await promptFile.text();
      promptName = promptFile.name;
    } else if (typeof promptText === "string" && promptText.trim()) {
      text = promptText;
      promptName = "inline-prompt.txt";
    } else {
      const s = loadState() as { projects: unknown[]; versions: unknown[]; uploadedPrompt?: { name: string; content: string } };
      if (!s.uploadedPrompt)
        return NextResponse.json({ error: "No engineering prompt provided." }, { status: 400 });
      text = s.uploadedPrompt.content;
      promptName = s.uploadedPrompt.name;
    }

    const { runId } = startPipelineCycle("__platform__");

    return NextResponse.json({ runId, zipPath, zipName, promptName, parentVersionId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
