import type { ToolDef, ToolSpec } from "../types";
import { toolCapabilityDescriptor } from "../tool-capability";
import { currentTimeTool } from "./currentTime";
import { calculatorTool } from "./calculator";
import { httpFetchTool } from "./httpFetch";
import { writeArtifactTool } from "./writeArtifact";
import { simulateDeployTool } from "./simulateDeploy";

const TOOLS: Record<string, ToolDef> = {
  [currentTimeTool.name]: currentTimeTool,
  [calculatorTool.name]: calculatorTool,
  [httpFetchTool.name]: httpFetchTool,
  [writeArtifactTool.name]: writeArtifactTool,
  [simulateDeployTool.name]: simulateDeployTool,
};

export function getTool(name: string): ToolDef | undefined {
  return TOOLS[name];
}

export function listTools(): ToolDef[] {
  return Object.values(TOOLS);
}

export function toolSpecs(names: string[]): ToolSpec[] {
  return names
    .map((n) => TOOLS[n])
    .filter((t): t is ToolDef => !!t)
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
}

export const ALL_TOOL_NAMES = Object.keys(TOOLS);
export const DEFAULT_AGENT_TOOLS = ["current_time", "calculator", "write_artifact"] as const;

export function listToolCapabilities() {
  return Object.values(TOOLS).map(toolCapabilityDescriptor);
}
