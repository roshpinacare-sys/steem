/**
 * lib/knowledgeGraph210.js — ECOS V210
 * Knowledge Graph API: queryable graph of semantic patch relationships.
 * Research: Wikidata + knowledge graph traversal — patches are nodes, reuse edges connect them.
 */
'use strict';

const MAX_NODES_210        = 50_000;
const MAX_EDGES_210        = 200_000;
const MAX_NEIGHBORS_210    = 50;
const MAX_PATH_DEPTH_210   = 6;   // BFS depth limit

class KnowledgeGraphError210 extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'KnowledgeGraphError210';
    this.code = code || 'KNOWLEDGE_GRAPH_ERROR_210';
    this.statusCode = 400;
  }
}

// In-memory adjacency graph
// _graphNodes210: Map<nodeId, { nodeId, type, label, royaltyTotal, reuseCount, createdAt, domain }>
// _graphEdges210: Map<edgeKey, { from, to, weight, edgeType, createdAt }>
const _graphNodes210 = new Map();
const _graphEdges210 = new Map();
let _nodeCounter210 = 0;

/**
 * addNode210 — register a patch/concept as a graph node.
 */
function addNode210(params) {
  if (!params || typeof params !== 'object') throw new KnowledgeGraphError210('params required');
  const { nodeId, label, type, domain, royaltyTotal, reuseCount } = params;
  if (!nodeId) throw new KnowledgeGraphError210('nodeId required');
  if (_graphNodes210.size >= MAX_NODES_210) throw new KnowledgeGraphError210('Node store full');

  const node = {
    nodeId,
    label:        label || nodeId,
    type:         type  || 'patch',   // patch | concept | task | validator
    domain:       domain || 'general',
    royaltyTotal: typeof royaltyTotal === 'number' ? royaltyTotal : 0,
    reuseCount:   typeof reuseCount   === 'number' ? reuseCount   : 0,
    createdAt:    new Date().toISOString(),
  };
  _graphNodes210.set(nodeId, node);
  _nodeCounter210++;
  return { ok: true, node: { ...node } };
}

/**
 * addEdge210 — connect two nodes (directed edge).
 */
function addEdge210(from, to, options) {
  if (!from || !to) throw new KnowledgeGraphError210('from and to required');
  if (!_graphNodes210.has(from)) throw new KnowledgeGraphError210(`Node ${from} not found`, 'NODE_NOT_FOUND_210');
  if (!_graphNodes210.has(to))   throw new KnowledgeGraphError210(`Node ${to} not found`, 'NODE_NOT_FOUND_210');
  if (_graphEdges210.size >= MAX_EDGES_210) throw new KnowledgeGraphError210('Edge store full');

  const edgeKey = `${from}→${to}`;
  const existing = _graphEdges210.get(edgeKey);
  if (existing) {
    existing.weight++;
    existing.lastSeenAt = new Date().toISOString();
    return { ok: true, edge: { ...existing }, updated: true };
  }

  const edge = {
    from, to,
    edgeType:  (options && options.edgeType)  || 'reuse',   // reuse | derived | cites | contradicts
    weight:    (options && options.weight != null) ? options.weight : 1,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  _graphEdges210.set(edgeKey, edge);
  return { ok: true, edge: { ...edge }, updated: false };
}

/**
 * getGraphSummary210 — high-level graph stats + top nodes.
 */
function getGraphSummary210(params) {
  const { topN, domain } = params || {};
  const n = typeof topN === 'number' ? Math.min(topN, 100) : 10;

  let nodes = [..._graphNodes210.values()];
  if (domain) nodes = nodes.filter(nd => nd.domain === domain);

  const topByReuse = [...nodes].sort((a, b) => b.reuseCount - a.reuseCount).slice(0, n);
  const topByRoyalty = [...nodes].sort((a, b) => b.royaltyTotal - a.royaltyTotal).slice(0, n);

  return {
    ok: true,
    totalNodes:  _graphNodes210.size,
    totalEdges:  _graphEdges210.size,
    topByReuse,
    topByRoyalty,
    domains: [...new Set([..._graphNodes210.values()].map(nd => nd.domain))],
  };
}

/**
 * getNeighbors210 — return all direct neighbors of a node.
 */
function getNeighbors210(nodeId, opts) {
  if (!nodeId) throw new KnowledgeGraphError210('nodeId required');
  if (!_graphNodes210.has(nodeId)) {
    const e = new KnowledgeGraphError210(`Node ${nodeId} not found`, 'NODE_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }

  const direction = (opts && opts.direction) || 'both'; // 'out' | 'in' | 'both'
  const limit     = Math.min((opts && opts.limit) || MAX_NEIGHBORS_210, MAX_NEIGHBORS_210);

  const outgoing = [], incoming = [];

  for (const [key, edge] of _graphEdges210) {
    if (edge.from === nodeId && (direction === 'out' || direction === 'both')) {
      const target = _graphNodes210.get(edge.to);
      if (target) outgoing.push({ ...target, edge: { ...edge } });
    }
    if (edge.to === nodeId && (direction === 'in' || direction === 'both')) {
      const source = _graphNodes210.get(edge.from);
      if (source) incoming.push({ ...source, edge: { ...edge } });
    }
  }

  return {
    ok: true,
    nodeId,
    node: { ..._graphNodes210.get(nodeId) },
    outgoing: outgoing.slice(0, limit),
    incoming: incoming.slice(0, limit),
    outDegree: outgoing.length,
    inDegree:  incoming.length,
  };
}

/**
 * findPath210 — BFS shortest path between two nodes.
 */
function findPath210(fromId, toId) {
  if (!fromId || !toId) throw new KnowledgeGraphError210('fromId and toId required');
  if (!_graphNodes210.has(fromId)) {
    const e = new KnowledgeGraphError210(`Node ${fromId} not found`, 'NODE_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }
  if (!_graphNodes210.has(toId)) {
    const e = new KnowledgeGraphError210(`Node ${toId} not found`, 'NODE_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }

  if (fromId === toId) return { ok: true, path: [fromId], distance: 0, found: true };

  // BFS
  const visited  = new Set([fromId]);
  const queue    = [[fromId]];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (currentPath.length > MAX_PATH_DEPTH_210) break;

    const current = currentPath[currentPath.length - 1];
    for (const [, edge] of _graphEdges210) {
      if (edge.from !== current) continue;
      const next = edge.to;
      if (visited.has(next)) continue;
      const newPath = [...currentPath, next];
      if (next === toId) return { ok: true, path: newPath, distance: newPath.length - 1, found: true };
      visited.add(next);
      queue.push(newPath);
    }
  }

  return { ok: true, path: [], distance: -1, found: false };
}

module.exports = {
  addNode210,
  addEdge210,
  getGraphSummary210,
  getNeighbors210,
  findPath210,
  KnowledgeGraphError210,
  MAX_NODES_210,
  MAX_EDGES_210,
  MAX_NEIGHBORS_210,
  MAX_PATH_DEPTH_210,
  _graphNodes210,
  _graphEdges210,
};
