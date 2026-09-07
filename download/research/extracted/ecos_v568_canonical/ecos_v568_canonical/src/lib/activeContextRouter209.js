/**
   * lib/activeContextRouter209.js — ECOS V209
   * Active Context Router: AI reads chat messages and proactively surfaces task suggestions.
   * Research: ECOS unique differentiator — contextual AI assistance.
   */
  'use strict';

  const CONTEXT_INTENTS_209 = [
    { intent: 'create_task',      keywords: ['create task','new task','add task','todo','to-do','assign','delegate'] },
    { intent: 'pay',              keywords: ['pay','transfer','send credits','withdraw','payout'] },
    { intent: 'review',           keywords: ['review','check','validate','approve','verify','inspect'] },
    { intent: 'report',           keywords: ['report','analytics','stats','metrics','dashboard','summary'] },
    { intent: 'governance',       keywords: ['vote','proposal','governance','veto','quorum'] },
    { intent: 'burn',             keywords: ['burn','deflation','token burn','buy back'] },
    { intent: 'streak',           keywords: ['streak','daily','habit','activity','freeze'] },
    { intent: 'escrow',           keywords: ['escrow','proof','release payment','deliverable'] },
    { intent: 'reputation',       keywords: ['reputation','decay','rank','score','trust'] },
  ];

  const MAX_CONTEXT_MESSAGES_209  = 20;
  const MAX_SUGGESTIONS_209       = 5;

  class ContextRouterError209 extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'ContextRouterError209';
      this.code = code || 'CONTEXT_ROUTER_ERROR_209';
      this.statusCode = 400;
    }
  }

  /**
   * analyzeContext209 — parse an array of chat messages, detect intents, return actionable suggestions.
   * @param {object} params
   * @param {string[]} params.messages       — recent chat messages (last N)
   * @param {string}  [params.workspaceId]
   * @param {object}  [params.workspaceState] — { currentStreak, pendingTasks, balanceUsd }
   * @returns {{ intents, suggestions, confidence, contextSummary }}
   */
  function analyzeContext209(params) {
    if (!params || typeof params !== 'object') throw new ContextRouterError209('params required');
    const { messages, workspaceState } = params;
    if (!Array.isArray(messages)) throw new ContextRouterError209('messages must be an array');
    if (messages.length === 0) {
      return { intents: [], suggestions: [], confidence: 0, contextSummary: 'No messages to analyze', ecosVersion: 'V209' };
    }

    const recentMsgs = messages.slice(-MAX_CONTEXT_MESSAGES_209);
    const combined   = recentMsgs.join(' ').toLowerCase();

    // Detect intents with scoring
    const detectedIntents = [];
    for (const { intent, keywords } of CONTEXT_INTENTS_209) {
      const matches = keywords.filter(kw => combined.includes(kw));
      if (matches.length > 0) {
        detectedIntents.push({
          intent,
          matchedKeywords: matches,
          score: matches.length / keywords.length,
        });
      }
    }
    detectedIntents.sort((a, b) => b.score - a.score);

    // Build suggestions
    const suggestions = [];
    const ws = workspaceState || {};

    for (const { intent } of detectedIntents.slice(0, MAX_SUGGESTIONS_209)) {
      switch (intent) {
        case 'create_task':
          suggestions.push({ action: 'POST /api/v1/workspaces/:id/tasks', label: 'Create a new task', priority: 'high' });
          break;
        case 'pay':
          suggestions.push({ action: 'POST /api/v1/workspaces/:id/wallet/provision', label: 'Check wallet balance or initiate transfer', priority: 'high' });
          break;
        case 'review':
          suggestions.push({ action: 'GET /api/v1/approvals', label: 'View pending approvals for review', priority: 'medium' });
          break;
        case 'report':
          suggestions.push({ action: 'GET /api/v1/admin/summary/v208', label: 'View system health dashboard', priority: 'medium' });
          break;
        case 'governance':
          suggestions.push({ action: 'POST /api/v1/governance/proposals', label: 'Submit or review a governance proposal', priority: 'medium' });
          break;
        case 'burn':
          suggestions.push({ action: 'POST /api/v1/treasury/burn-schedule', label: 'Schedule a token burn', priority: 'low' });
          break;
        case 'streak':
          suggestions.push({ action: 'POST /api/v1/workspaces/:id/streak/record', label: 'Record today\'s activity to maintain streak', priority: ws.currentStreak > 5 ? 'high' : 'medium' });
          break;
        case 'escrow':
          suggestions.push({ action: 'POST /api/v1/tasks/:id/proof', label: 'Submit proof of work for escrow release', priority: 'high' });
          break;
        case 'reputation':
          suggestions.push({ action: 'GET /api/v1/workspaces/:id/reputation/decay-preview', label: 'Check your reputation decay forecast', priority: 'low' });
          break;
      }
    }

    const totalKeywordsMatched = detectedIntents.reduce((s, d) => s + d.matchedKeywords.length, 0);
    const confidence = Math.min(1, totalKeywordsMatched / (recentMsgs.length * 2));

    return {
      intents:        detectedIntents,
      suggestions:    suggestions.slice(0, MAX_SUGGESTIONS_209),
      confidence:     +confidence.toFixed(3),
      messagesAnalyzed: recentMsgs.length,
      contextSummary: detectedIntents.length > 0
        ? `Detected ${detectedIntents.length} intent(s): ${detectedIntents.map(d => d.intent).join(', ')}`
        : 'No actionable intents detected in recent messages',
      ecosVersion: 'V209',
    };
  }

  module.exports = {
    analyzeContext209,
    CONTEXT_INTENTS_209,
    ContextRouterError209,
    MAX_CONTEXT_MESSAGES_209,
    MAX_SUGGESTIONS_209,
  };
  