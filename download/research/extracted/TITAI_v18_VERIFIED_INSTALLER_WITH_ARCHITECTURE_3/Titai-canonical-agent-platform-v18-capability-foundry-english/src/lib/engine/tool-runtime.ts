import type { ToolContext, ToolDef, ToolResult } from "./types";

export interface BoundedToolExecution {
  result: ToolResult;
  outputBytes: number;
  timedOut: boolean;
}

export async function executeBoundedTool(
  tool: ToolDef,
  args: Record<string, unknown>,
  context: Omit<ToolContext, "signal">,
  parentSignal: AbortSignal,
): Promise<BoundedToolExecution> {
  const timeoutSignal = AbortSignal.timeout(tool.timeoutMs);
  const signal = AbortSignal.any([parentSignal, timeoutSignal]);
  try {
    const result = await tool.execute(args, { ...context, signal });
    const outputBytes = Buffer.byteLength(JSON.stringify(result.output ?? null), "utf8");
    if (outputBytes > tool.maxOutputBytes) {
      return {
        result: {
          ok: false,
          output: null,
          error: `tool_output_limit_exceeded:${outputBytes}:${tool.maxOutputBytes}`,
        },
        outputBytes,
        timedOut: false,
      };
    }
    return { result, outputBytes, timedOut: false };
  } catch (error) {
    const timedOut = timeoutSignal.aborted && !parentSignal.aborted;
    return {
      result: {
        ok: false,
        output: null,
        error: timedOut
          ? `tool_timeout:${tool.timeoutMs}`
          : error instanceof Error
            ? error.message
            : "Tool error",
      },
      outputBytes: 0,
      timedOut,
    };
  }
}
