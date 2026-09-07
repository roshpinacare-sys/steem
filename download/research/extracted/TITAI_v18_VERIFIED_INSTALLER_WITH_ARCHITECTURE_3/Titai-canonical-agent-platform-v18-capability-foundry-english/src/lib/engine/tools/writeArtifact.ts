import type { ToolDef } from "../types";

const MAX_ARTIFACT_BYTES = 1_000_000;

export const writeArtifactTool: ToolDef = {
  name: "write_artifact",
  description:
    "Save a text/markdown/json artifact as a deliverable of this run.",
  risk: "low",
  schemaVersion: 1,
  effect: "write",
  idempotency: "intrinsic",
  network: false,
  filesystem: true,
  timeoutMs: 5000,
  maxOutputBytes: 1000000,
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "File name, e.g. 'report.md'.",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._-]+$",
      },
      kind: {
        type: "string",
        enum: ["markdown", "json", "text"],
        description: "Artifact kind.",
      },
      content: {
        type: "string",
        description: "The artifact content.",
        maxLength: MAX_ARTIFACT_BYTES,
      },
    },
    required: ["name", "content"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const name = String(args.name ?? "artifact.txt");
    const kind = (["markdown", "json", "text"].includes(String(args.kind))
      ? args.kind
      : "text") as "markdown" | "json" | "text";
    const content = String(args.content ?? "");
    if (Buffer.byteLength(content, "utf8") > MAX_ARTIFACT_BYTES) {
      return {
        ok: false,
        output: null,
        error: `Artifact exceeds ${MAX_ARTIFACT_BYTES} bytes.`,
      };
    }
    const id = ctx.writeArtifact({ name, kind, content, idempotencyKey: ctx.idempotencyKey });
    return { ok: true, output: { id, name, kind, sizeBytes: content.length } };
  },
};
