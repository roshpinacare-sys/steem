"use client";

import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

export function PulseEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const animated = (data as { animated?: boolean } | undefined)?.animated;

  return (
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      style={{
        stroke: animated
          ? "var(--color-status-running)"
          : "var(--color-border-strong)",
        strokeWidth: animated ? 2 : 1.5,
        strokeDasharray: animated ? "6 4" : undefined,
        animation: animated ? "titai-dash 0.6s linear infinite" : undefined,
      }}
    />
  );
}

export const edgeTypes = { pulse: PulseEdge };
