import dagre from "@dagrejs/dagre";
import type { RunGraph } from "./build-graph";
import type { Node, Edge } from "@xyflow/react";

const NODE_W = 190;
const NODE_H = 68;

export function layoutGraph(
  graph: RunGraph,
  direction: "TB" | "LR" = "TB",
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 60, nodesep: 32, marginx: 16, marginy: 16 });

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_W, height: NODE_H });
  }
  for (const edge of graph.edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }
  dagre.layout(g);

  const nodes: Node[] = graph.nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      id: node.id,
      type: node.kind,
      position: { x: (pos?.x ?? 0) - NODE_W / 2, y: (pos?.y ?? 0) - NODE_H / 2 },
      data: node as unknown as Record<string, unknown>,
    };
  });

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "pulse",
    animated: edge.animated,
    data: { animated: edge.animated },
  }));

  return { nodes, edges };
}
