"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Bot,
  Box,
  Wrench,
  ShieldAlert,
  FileText,
  Check,
  X,
} from "lucide-react";
import type { TitaiNode, NodeStatus } from "./build-graph";
import { TIER_META, RISK_META } from "@/lib/constants";
import { cn } from "@/lib/utils";

function statusColor(status: NodeStatus): string {
  switch (status) {
    case "running":
      return "var(--color-status-running)";
    case "completed":
    case "resolved":
      return "var(--color-status-completed)";
    case "failed":
    case "denied":
      return "var(--color-status-failed)";
    case "awaiting":
      return "var(--color-status-awaiting)";
    default:
      return "var(--color-border-strong)";
  }
}

function NodeFrame({
  data,
  children,
  accent,
}: {
  data: TitaiNode;
  children: React.ReactNode;
  accent: string;
}) {
  const pulsing = data.status === "running" || data.status === "awaiting";
  return (
    <div
      className={cn(
        "w-[190px] rounded-xl border bg-surface px-3 py-2.5 shadow-md transition-all",
        pulsing && "animate-pulse-ring",
      )}
      style={{ borderColor: accent }}
    >
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-border-strong" />
      {children}
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-border-strong" />
    </div>
  );
}

function Row({
  icon,
  label,
  sublabel,
  accent,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  accent: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4"
        style={{ backgroundColor: `color-mix(in oklch, ${accent} 18%, transparent)`, color: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-foreground">{label}</p>
        {sublabel && (
          <p className="truncate text-[10px] text-muted-foreground">{sublabel}</p>
        )}
      </div>
      {badge}
    </div>
  );
}

export function AgentNode({ data }: NodeProps) {
  const node = data as unknown as TitaiNode;
  const accent = node.tier
    ? `var(--color-${TIER_META[node.tier].color})`
    : statusColor(node.status);
  return (
    <NodeFrame data={node} accent={accent}>
      <Row icon={<Bot />} label={node.label} sublabel={node.sublabel} accent={accent} />
    </NodeFrame>
  );
}

export function StepNode({ data }: NodeProps) {
  const node = data as unknown as TitaiNode;
  const accent = statusColor(node.status);
  return (
    <NodeFrame data={node} accent={accent}>
      <Row icon={<Box />} label={node.label} sublabel={node.sublabel} accent={accent} />
    </NodeFrame>
  );
}

export function ToolNode({ data }: NodeProps) {
  const node = data as unknown as TitaiNode;
  const accent = statusColor(node.status);
  const riskColor = node.risk ? `var(--color-${RISK_META[node.risk].color})` : accent;
  return (
    <NodeFrame data={node} accent={accent}>
      <Row
        icon={<Wrench />}
        label={node.label}
        accent={accent}
        badge={
          node.risk ? (
            <span
              className="rounded px-1 py-0.5 text-[9px] font-medium uppercase"
              style={{ color: riskColor, backgroundColor: `color-mix(in oklch, ${riskColor} 14%, transparent)` }}
            >
              {node.risk}
            </span>
          ) : undefined
        }
      />
    </NodeFrame>
  );
}

export function ApprovalNode({ data }: NodeProps) {
  const node = data as unknown as TitaiNode;
  const accent = statusColor(node.status);
  const resolved = node.status !== "awaiting";
  return (
    <NodeFrame data={node} accent={accent}>
      <Row
        icon={resolved ? node.status === "resolved" ? <Check /> : <X /> : <ShieldAlert />}
        label={node.label}
        sublabel={node.sublabel}
        accent={accent}
      />
    </NodeFrame>
  );
}

export function ArtifactNode({ data }: NodeProps) {
  const node = data as unknown as TitaiNode;
  const accent = "var(--color-primary)";
  return (
    <NodeFrame data={node} accent={accent}>
      <Row icon={<FileText />} label={node.label} sublabel={node.sublabel} accent={accent} />
    </NodeFrame>
  );
}

export const nodeTypes = {
  agent: AgentNode,
  step: StepNode,
  tool: ToolNode,
  approval: ApprovalNode,
  artifact: ArtifactNode,
};
