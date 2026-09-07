import { log } from "../services/logger.js";
import type { ZodSchema, ZodError } from "zod";

function formatZodErrors(error: ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

export interface AIContractFailure {
  prompt: string;
  raw: string;
  error: string;
}

export class AIContractError extends Error {
  constructor(message: string, public failure: AIContractFailure) {
    super(message);
  }
}

export async function validateAndRetry<T>(
  generate: (feedback: string) => Promise<{ prompt: string; raw: string }>,
  schema: ZodSchema<T>,
  retries = 2,
  guard?: (value: T) => void | Promise<void>,
): Promise<T> {
  let lastErr: unknown;
  let lastFailure: AIContractFailure | null = null;
  let feedback = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { prompt, raw } = await generate(feedback);
      lastFailure = { prompt, raw, error: "" };
      try {
        const parsed = JSON.parse(raw);
        const value = schema.parse(parsed);
        if (guard) await guard(value);
        return value;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        lastFailure.error = msg;
        log.warn('schema-validator: attempt failed', { attempt: attempt + 1, error: msg });
        feedback = `Previous attempt failed validation: ${msg}. Please fix the JSON and return a valid object matching the required schema.`;
      }
    } catch (networkErr: unknown) {
      const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
      log.warn('schema-validator: network/generation error', { attempt: attempt + 1, error: msg });
      feedback += " Network error, retrying...";
      lastFailure = { prompt: "", raw: "", error: msg };
    }
  }
  const lastErrMsg = lastErr instanceof Error ? lastErr.message : (lastFailure?.error ?? "unknown");
  throw new AIContractError(`AI contract violation after retries: ${lastErrMsg}`, lastFailure!);
}
