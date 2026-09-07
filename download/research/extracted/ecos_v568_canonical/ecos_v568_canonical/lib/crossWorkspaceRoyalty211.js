/**
   * lib/crossWorkspaceRoyalty211.js — ECOS V211
   * Cross-Workspace Royalty Settlement: when workspace B reuses a patch from workspace A,
   * royalty flows automatically to A's owner through the referral propagation chain.
   * Extends knowledgeGraph210 edge model + referralEngine210 tree propagation.
   */
  'use strict';

  const XROYALTY_RATE_211          = 0.03;   // 3% of earnings paid when reusing a patch
  const XROYALTY_MAX_CHAIN_211     = 3;      // propagate up 3 ancestor workspaces
  const XROYALTY_DECAY_211         = 0.60;   // 60% of previous level passed to next ancestor
  const XROYALTY_MIN_CENTS_211     = 1;      // stop propagation below 1 cent (in microcents: 10000)
  const MAX_ROYALTY_RECORDS_211    = 100_000;

  class CrossRoyaltyError211 extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'CrossRoyaltyError211';
      this.code = code || 'XROYALTY_ERROR_211';
      this.statusCode = 400;
    }
  }

  // _xRoyaltyLedger211: settlementId → settlement record
  const _xRoyaltyLedger211 = new Map();
  // _xRoyaltyByWorkspace211: workspaceId → [settlementId, ...]
  const _xRoyaltyByWorkspace211 = new Map();
  let _xRoyaltyCounter211 = 0;

  /**
   * settleXRoyalty211 — settle royalties when a workspace reuses a patch.
   * @param {object} params
   * @param {string} params.patchId             — patch being reused
   * @param {string} params.reusingWorkspaceId  — the workspace that is reusing the patch
   * @param {string} params.originWorkspaceId   — the workspace that owns the patch
   * @param {number} params.earningsUsd         — earnings the reusing workspace made from this patch
   * @param {string[]} [params.ancestorChain]   — optional: ancestor workspace IDs (up to XROYALTY_MAX_CHAIN_211)
   */
  function settleXRoyalty211(params) {
    if (!params || typeof params !== 'object') throw new CrossRoyaltyError211('params required');
    const { patchId, reusingWorkspaceId, originWorkspaceId, earningsUsd, ancestorChain } = params;

    if (!patchId)            throw new CrossRoyaltyError211('patchId required');
    if (!reusingWorkspaceId) throw new CrossRoyaltyError211('reusingWorkspaceId required');
    if (!originWorkspaceId)  throw new CrossRoyaltyError211('originWorkspaceId required');
    if (reusingWorkspaceId === originWorkspaceId) throw new CrossRoyaltyError211('Cannot settle royalty within same workspace', 'SAME_WORKSPACE_211');
    if (typeof earningsUsd !== 'number' || earningsUsd <= 0) throw new CrossRoyaltyError211('earningsUsd must be positive');
    if (_xRoyaltyLedger211.size >= MAX_ROYALTY_RECORDS_211) throw new CrossRoyaltyError211('Royalty ledger full');

    const baseRoyaltyUsd = +(earningsUsd * XROYALTY_RATE_211).toFixed(6);
    const distributions = [];

    // Level 0: origin workspace always receives base royalty
    distributions.push({
      level: 0,
      workspaceId: originWorkspaceId,
      royaltyUsd: baseRoyaltyUsd,
      reason: 'patch_origin',
    });

    // Propagate through ancestor chain
    const chain = Array.isArray(ancestorChain) ? ancestorChain.slice(0, XROYALTY_MAX_CHAIN_211) : [];
    let cascadeAmount = baseRoyaltyUsd;
    for (let i = 0; i < chain.length; i++) {
      cascadeAmount = +(cascadeAmount * XROYALTY_DECAY_211).toFixed(6);
      if (cascadeAmount * 100 < XROYALTY_MIN_CENTS_211) break;  // below 1 cent
      if (chain[i] && chain[i] !== reusingWorkspaceId && chain[i] !== originWorkspaceId) {
        distributions.push({
          level: i + 1,
          workspaceId: chain[i],
          royaltyUsd: cascadeAmount,
          reason: 'ancestor_cascade',
        });
      }
    }

    const totalRoyaltyUsd = +distributions.reduce((s, d) => s + d.royaltyUsd, 0).toFixed(6);
    const settlementId = 'xroyalty-' + (++_xRoyaltyCounter211) + '-' + Date.now();
    const record = {
      settlementId,
      patchId,
      reusingWorkspaceId,
      originWorkspaceId,
      earningsUsd: +earningsUsd.toFixed(6),
      royaltyRate: XROYALTY_RATE_211,
      totalRoyaltyUsd,
      distributions,
      settledAt: new Date().toISOString(),
      status: 'settled',
    };

    _xRoyaltyLedger211.set(settlementId, record);
    distributions.forEach(d => {
      if (!_xRoyaltyByWorkspace211.has(d.workspaceId)) _xRoyaltyByWorkspace211.set(d.workspaceId, []);
      _xRoyaltyByWorkspace211.get(d.workspaceId).push(settlementId);
    });

    return { ok: true, settlementId, totalRoyaltyUsd, distributions, settledAt: record.settledAt };
  }

  /**
   * getWorkspaceRoyaltyLedger211 — get all royalty settlements for a workspace.
   * @param {string} workspaceId
   * @param {object} [opts]
   * @param {number} [opts.limit=50]
   * @param {number} [opts.offset=0]
   */
  function getWorkspaceRoyaltyLedger211(workspaceId, opts) {
    if (!workspaceId) throw new CrossRoyaltyError211('workspaceId required');
    const ids = _xRoyaltyByWorkspace211.get(workspaceId) || [];
    const { limit = 50, offset = 0 } = opts || {};
    const page = ids.slice(offset, offset + limit).map(id => _xRoyaltyLedger211.get(id)).filter(Boolean);
    const totalReceived = ids
      .map(id => _xRoyaltyLedger211.get(id))
      .filter(Boolean)
      .flatMap(r => r.distributions)
      .filter(d => d.workspaceId === workspaceId)
      .reduce((s, d) => s + d.royaltyUsd, 0);

    return {
      ok: true,
      workspaceId,
      totalSettlements: ids.length,
      totalReceivedUsd: +totalReceived.toFixed(6),
      page,
      offset,
      limit,
    };
  }

  module.exports = {
    settleXRoyalty211, getWorkspaceRoyaltyLedger211,
    XROYALTY_RATE_211, XROYALTY_MAX_CHAIN_211,
    _xRoyaltyLedger211, _xRoyaltyByWorkspace211,
  };
  