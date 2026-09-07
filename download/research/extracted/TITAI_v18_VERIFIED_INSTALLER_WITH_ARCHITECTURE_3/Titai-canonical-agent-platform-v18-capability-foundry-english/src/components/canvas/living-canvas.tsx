"use client";

import * as React from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTranslations } from "next-intl";
import { buildRunGraph } from "./build-graph";
import { layoutGraph } from "./layout";
import { nodeTypes } from "./nodes";
import { edgeTypes } from "./pulse-edge";
import { EmptyState } from "@/components/ui/misc";
import { Network } from "lucide-react";
import type { ClientRunEvent } from "@/lib/engine/event-types";

function CanvasInner({ events }: { events: ClientRunEvent[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const nodeCountRef = React.useRef(0);

  React.useEffect(() => {
    const graph = buildRunGraph(events);
    if (graph.nodes.length === 0) return;
    const isMobile =
      typeof window !== "undefined" && window.innerWidth < 640;
    const laid = layoutGraph(graph, isMobile ? "LR" : "TB");

    const grew = graph.nodes.length !== nodeCountRef.current;
    nodeCountRef.current = graph.nodes.length;

    if (grew) {
      setNodes(laid.nodes);
      setEdges(laid.edges);
      // Fit after the new nodes have been committed + measured.
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          fitView({ padding: 0.2, duration: 300 }),
        ),
      );
    } else {
      // Same structure — just refresh data (status/pulse) in place.
      setNodes((prev) =>
        prev.map((n) => {
          const next = laid.nodes.find((x) => x.id === n.id);
          return next ? { ...n, data: next.data } : n;
        }),
      );
      setEdges(laid.edges);
    }
  }, [events, setNodes, setEdges, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      minZoom={0.25}
      maxZoom={1.6}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1}
        color="var(--color-border)"
      />
      <Controls
        showInteractive={false}
        className="!border-border [&_button]:!border-border [&_button]:!bg-surface-raised [&_button]:!fill-muted-foreground"
      />
    </ReactFlow>
  );
}

export function LivingCanvas({ events }: { events: ClientRunEvent[] }) {
  const t = useTranslations();
  const hasNodes = buildRunGraph(events).nodes.length > 0;

  if (!hasNodes) {
    return (
      <div className="flex h-[480px] items-center justify-center rounded-lg border border-border">
        <EmptyState icon={<Network />} title={t("runs.noEvents")} />
      </div>
    );
  }

  return (
    // React Flow assumes LTR coordinate math — pin the island to ltr.
    <div
      dir="ltr"
      className="h-[min(72vh,640px)] overflow-hidden rounded-lg border border-border bg-surface/40"
    >
      <ReactFlowProvider>
        <CanvasInner events={events} />
      </ReactFlowProvider>
    </div>
  );
}
