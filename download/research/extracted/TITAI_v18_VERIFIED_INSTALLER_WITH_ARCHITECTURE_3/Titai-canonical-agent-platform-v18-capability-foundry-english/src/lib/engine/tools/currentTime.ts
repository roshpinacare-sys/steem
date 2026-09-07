import type { ToolDef } from "../types";

export const currentTimeTool: ToolDef = {
  name: "current_time",
  description: "Get the current date and time in ISO 8601 format.",
  risk: "low",
  schemaVersion: 1,
  effect: "read",
  idempotency: "intrinsic",
  network: false,
  filesystem: false,
  timeoutMs: 2000,
  maxOutputBytes: 10000,
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "Optional IANA timezone, e.g. 'UTC' or 'Asia/Jerusalem'.",
        minLength: 1,
        maxLength: 100,
      },
    },
    additionalProperties: false,
  },
  async execute(args) {
    const tz = typeof args.timezone === "string" ? args.timezone : "UTC";
    const now = new Date();
    let formatted: string;
    try {
      formatted = now.toLocaleString("en-US", { timeZone: tz });
    } catch {
      formatted = now.toISOString();
    }
    return {
      ok: true,
      output: { iso: now.toISOString(), timezone: tz, formatted },
    };
  },
};
