/**
   * lib/semanticClustering211.js — ECOS V211
   * Knowledge Graph Semantic Clustering: auto-cluster patch nodes by domain using Jaccard similarity.
   * Used to route tasks to the most relevant validators.
   * Extends the knowledgeGraph210 node model (no direct import — operates on supplied node lists).
   */
  'use strict';

  const CLUSTER_JACCARD_THRESHOLD_211 = 0.25; // min Jaccard similarity to merge into same cluster
  const MAX_CLUSTER_NODES_211         = 50_000;
  const MAX_CLUSTERS_211              = 500;

  class ClusterError211 extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'ClusterError211';
      this.code = code || 'CLUSTER_ERROR_211';
      this.statusCode = 400;
    }
  }

  // _clusters211: clusterId → cluster object
  const _clusters211 = new Map();
  let _clusterCounter211 = 0;

  /**
   * _tokenise211 — split a string into lowercase word tokens (no external deps).
   */
  function _tokenise211(text) {
    if (!text || typeof text !== 'string') return new Set();
    return new Set(text.toLowerCase().replace(/[^a-z0-9s]/g, ' ').split(/s+/).filter(t => t.length > 2));
  }

  /**
   * _jaccard211 — Jaccard similarity between two token sets.
   */
  function _jaccard211(setA, setB) {
    if (!setA.size && !setB.size) return 1.0;
    if (!setA.size || !setB.size) return 0.0;
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter++;
    return inter / (setA.size + setB.size - inter);
  }

  /**
   * clusterNodes211 — cluster a list of patch nodes by domain using Jaccard greedy clustering.
   * @param {Array<{nodeId: string, domain?: string, labels?: string[], description?: string}>} nodes
   */
  function clusterNodes211(nodes) {
    if (!Array.isArray(nodes)) throw new ClusterError211('nodes array required');
    if (nodes.length > MAX_CLUSTER_NODES_211) throw new ClusterError211('Too many nodes to cluster');

    // Clear previous clusters
    _clusters211.clear();
    _clusterCounter211 = 0;

    // Build token sets for each node
    const tokenSets = nodes.map(n => ({
      nodeId: n.nodeId,
      tokens: _tokenise211([n.domain || '', n.description || '', ...(n.labels || [])].join(' ')),
      domain: n.domain || 'unknown',
    }));

    // Greedy clustering: each node joins the first cluster whose centroid Jaccard >= threshold
    const assignments = new Map(); // nodeId → clusterId
    const centroids   = new Map(); // clusterId → merged token set

    for (const item of tokenSets) {
      let bestCluster = null;
      let bestScore   = CLUSTER_JACCARD_THRESHOLD_211 - 0.001;

      for (const [cId, centroid] of centroids) {
        const score = _jaccard211(item.tokens, centroid);
        if (score > bestScore) { bestScore = score; bestCluster = cId; }
      }

      if (!bestCluster) {
        if (_clusterCounter211 >= MAX_CLUSTERS_211) {
          bestCluster = 'cluster-overflow-211';
          if (!centroids.has(bestCluster)) centroids.set(bestCluster, new Set());
        } else {
          bestCluster = 'cluster-' + (++_clusterCounter211) + '-211';
          centroids.set(bestCluster, new Set(item.tokens));
        }
      } else {
        // Merge tokens into centroid
        const merged = centroids.get(bestCluster);
        for (const t of item.tokens) merged.add(t);
      }

      assignments.set(item.nodeId, bestCluster);
      if (!_clusters211.has(bestCluster)) {
        _clusters211.set(bestCluster, {
          clusterId: bestCluster,
          nodeIds: [],
          topDomains: {},
          topTokens: [],
          size: 0,
        });
      }
      const cluster = _clusters211.get(bestCluster);
      cluster.nodeIds.push(item.nodeId);
      cluster.size++;
      cluster.topDomains[item.domain] = (cluster.topDomains[item.domain] || 0) + 1;
    }

    // Compute top tokens per cluster from centroid
    for (const [cId, centroid] of centroids) {
      if (_clusters211.has(cId)) {
        _clusters211.get(cId).topTokens = [...centroid].slice(0, 10);
      }
    }

    return {
      ok: true,
      totalNodes: nodes.length,
      totalClusters: _clusters211.size,
      threshold: CLUSTER_JACCARD_THRESHOLD_211,
      clusters: [..._clusters211.values()].map(c => ({
        clusterId: c.clusterId,
        size: c.size,
        primaryDomain: Object.entries(c.topDomains).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'unknown',
        topTokens: c.topTokens.slice(0, 5),
      })),
    };
  }

  function getCluster211(clusterId) {
    if (!clusterId) throw new ClusterError211('clusterId required');
    const cluster = _clusters211.get(clusterId);
    if (!cluster) {
      const e = new ClusterError211('Cluster ' + clusterId + ' not found', 'CLUSTER_NOT_FOUND_211');
      e.statusCode = 404; throw e;
    }
    return { ok: true, cluster };
  }

  function getAllClusters211() {
    return {
      ok: true,
      totalClusters: _clusters211.size,
      clusters: [..._clusters211.values()],
    };
  }

  module.exports = {
    clusterNodes211, getCluster211, getAllClusters211,
    CLUSTER_JACCARD_THRESHOLD_211,
    _clusters211,
  };
  