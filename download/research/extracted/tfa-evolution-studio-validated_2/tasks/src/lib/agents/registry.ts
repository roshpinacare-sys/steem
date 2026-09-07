/**
 * TFA Evolution Studio v28 — Agent Registry
 *
 * Defines the autonomous agent organization.
 * Static registry with clear layer separation.
 */

import type { Agent } from "@/lib/types";

const AGENTS: Agent[] = [
  // Executive Layer
  {
    role: "platform-director",
    layer: "executive",
    title: "Platform Director",
    responsibility: "Sets strategic direction, approves major releases, and resolves cross-team conflicts.",
  },
  {
    role: "release-governor",
    layer: "executive",
    title: "Release Governor",
    responsibility: "Enforces release gates, version coherence, and artifact integrity before any release is published.",
  },
  // Engineering Layer
  {
    role: "compiler-engineer",
    layer: "engineering",
    title: "Compiler Engineer",
    responsibility: "Transforms canonical IR into target-specific builds using the adapter ecosystem.",
  },
  {
    role: "pipeline-engineer",
    layer: "engineering",
    title: "Pipeline Engineer",
    responsibility: "Orchestrates ZIP → IR → plan → execute → validate → package with deterministic ordering.",
  },
  {
    role: "adapter-specialist",
    layer: "engineering",
    title: "Adapter Specialist",
    responsibility: "Maintains adapter lifecycle hooks, target discovery, and fail-closed behavior for unknown targets.",
  },
  {
    role: "architecture-analyst",
    layer: "engineering",
    title: "Architecture Analyst",
    responsibility: "Builds module graphs, detects drift, identifies refactoring candidates, and tracks coupling.",
  },
  // Quality Layer
  {
    role: "validation-engineer",
    layer: "quality",
    title: "Validation Engineer",
    responsibility: "Runs evidence chain gates, completion thresholds, and integrity checks on every artifact.",
  },
  {
    role: "test-strategist",
    layer: "quality",
    title: "Test Strategist",
    responsibility: "Designs smoke tests, coherence checks, and runtime regression detection for the platform.",
  },
  {
    role: "observability-lead",
    layer: "quality",
    title: "Observability Lead",
    responsibility: "Captures traces, metrics, and logs for every pipeline run and integration call.",
  },
  // Release Layer
  {
    role: "packaging-engineer",
    layer: "release",
    title: "Packaging Engineer",
    responsibility: "Produces versioned ZIPs with SHA-256 integrity, manifest consistency, and release notes.",
  },
  {
    role: "automation-operator",
    layer: "release",
    title: "Automation Operator",
    responsibility: "Triggers post-release automation rules, connector notifications, and backlog updates.",
  },
  {
    role: "learning-curator",
    layer: "release",
    title: "Learning Curator",
    responsibility: "Distills cycle outcomes into reusable recipes, failure patterns, and recovery playbooks.",
  },
];

export function listAgents(): Agent[] {
  return AGENTS;
}

export function getAgent(role: string): Agent | undefined {
  return AGENTS.find((a) => a.role === role);
}
