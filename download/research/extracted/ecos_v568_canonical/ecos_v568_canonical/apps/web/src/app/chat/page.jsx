/**
 * ECOS Master Chat — V38
 * ─────────────────────────────────────────────────────────────────────────────
 * The system's single entry point. Natural-language command routing.
 *
 * Layout (three panels, responsive):
 *   LEFT  (55%): Chat thread — user bubbles right, system left. Timestamps.
 *   RIGHT TOP  (45%, 60%): Live output panel — latest task result with verdict badge.
 *   RIGHT BOTTOM (45%, 40%): Session stats — missions, spend, duration, calibrator.
 *
 * Intent detection (client-side, keyword matching):
 *   "submit task / new mission / analyze / review" → POST /api/v1/task
 *   "my balance / wallet / earnings"               → GET  /api/v1/account?id=...
 *   "pending / queue / approvals"                  → GET  /api/v1/approvals?status=pending
 *   "calibrate / train / fit model"                → GET  /api/v1/calibrator
 *   "status / health / system"                     → GET  /api/v1/verify
 *   "deposit / add funds / top up"                 → POST /api/v1/deposit
 *   "approve <id> / reject <id>"                  → POST /api/v1/approvals/<id>/resolve
 *   "history / my missions / past tasks"           → local session.history
 *   "show mission / mission detail / view mission" → open /mission/<id>
 *   anything else                                  → AI response + suggested commands
 *
 * Input bar: text field + Send + rotating hint row (3 examples, every 8s).
 * "Switch to Validator view" link → /validator?validator=<sessionValidatorId>
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SessionProvider, useSession } from '../../lib/session';

// ── Express base URL ──────────────────────────────────────────────────────────
const EXPRESS_BASE =
  typeof window !== 'undefined' && window.__ECOS_EXPRESS_URL__
    ? window.__ECOS_EXPRESS_URL__
    : (process.env.NEXT_PUBLIC_EXPRESS_URL || 'http://localhost:3000');

// ── Hint commands that rotate every 8 seconds ─────────────────────────────────
const HINT_SETS = [
  ['submit task: review this contract', 'my balance', 'system status'],
  ['new mission: analyze document', 'pending approvals',
  'analyze: what is the system status', 'calibrate model'],
  ['review: check this text', 'wallet earnings', 'health check'],
  ['help', '?', 'what commands are available'],
];

// ── Intent detection ──────────────────────────────────────────────────────────
// [V81] Rewritten with anchored single-word triggers (^ $) and specific-to-general
// ordering to prevent misclassification (e.g. "analyze ledger" → AGENT_TASK, not LEDGER).
function detectIntent(text) {
  const t = text.toLowerCase().trim();
  // 1. HELP — strict anchors
  if (/^help$|^\?$|what can you do|^commands$/.test(t))           return 'HELP';
  // 2. HISTORY — anchored single-word or clear phrase
  if (/^history$|my missions|past tasks/.test(t))                 return 'HISTORY';
  // 3. DASHBOARD — anchored single-word or clear phrase
  if (/^dashboard$|system overview/.test(t))                      return 'DASHBOARD';
  // 4. HEALTH — anchored single-word or unambiguous phrases
  if (/^health$|server status|is.*running/.test(t))               return 'HEALTH';
  // 5. METRICS — anchored single-word triggers + prometheus (unambiguous)
  if (/^metrics$|^gauges$|prometheus/.test(t))                    return 'METRICS';
  // 6. LEDGER — anchored single-word + very specific balance phrases
  if (/^ledger$|^balance$|show.*balance/.test(t))                 return 'LEDGER';
  // 7. DEPOSIT — action phrases only
  if (/deposit|add funds|top up/.test(t))                         return 'DEPOSIT';
  // 8. RESOLVE — approve/reject
  if (/approve|reject/.test(t))                                   return 'RESOLVE';
  // 9. CALIBRATE
  if (/^calibrate$|^calibration$|train.*model|fit model/.test(t)) return 'CALIBRATE';
  // 10. STATUS — anchored or very specific
  if (/^status$|system.*status/.test(t))                          return 'STATUS';
  // 11. BALANCE (personal account balance)
  if (/my balance|wallet|earnings/.test(t))                       return 'BALANCE';
  // 12. APPROVALS
  if (/^approvals$|^pending$|pending.*queue|approval.*queue/.test(t)) return 'APPROVALS';
  // 13. PATCH_SEARCH
  if (/similar|find patch|search patches|patch search/.test(t))   return 'PATCH_SEARCH';
  // 14. MISSION_DETAIL
  if (/show mission|mission detail|view mission/.test(t))         return 'MISSION_DETAIL';
  // 15. AGENT_TASK — broad analytical phrases (placed late so specific intents win)
  if (/analyze|debug|explain why|what.*wrong|diagnose/.test(t))   return 'AGENT_TASK';
  // 16. Default: generic task
  return 'TASK';
}

// ── Verdict badge colors ──────────────────────────────────────────────────────
function verdictStyle(verdict) {
  if (!verdict) return { bg: '#374151', text: '#9ca3af' };
  switch (verdict.toUpperCase()) {
    case 'AUTO_FLOW':   return { bg: '#064e3b', text: '#34d399' };
    case 'HITL_QUEUE':  return { bg: '#78350f', text: '#fcd34d' };
    case 'HARD_REJECT': return { bg: '#7f1d1d', text: '#fca5a5' };
    default:            return { bg: '#1e3a5f', text: '#93c5fd' };
  }
}

// ── Timestamp formatter ───────────────────────────────────────────────────────
function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (_) { return ''; }
}

// ── Duration formatter ────────────────────────────────────────────────────────
function fmtDuration(startIso) {
  if (!startIso) return '—';
  const secs = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Welcome message ───────────────────────────────────────────────────────────
const WELCOME_MESSAGES = [
  {
    id: 'welcome-1',
    role: 'system',
    ts: new Date().toISOString(),
    text: '👋 Welcome to ECOS — the Proof of Intellectual Work protocol.',
  },
  {
    id: 'welcome-2',
    role: 'system',
    ts: new Date().toISOString(),
    text: '**Missions** are tasks you submit for AI processing. Each mission goes through a confidence gate: high-confidence results flow automatically; low-confidence results wait for a human validator.',
  },
  {
    id: 'welcome-3',
    role: 'system',
    ts: new Date().toISOString(),
    text: '**Validators** are humans who review and correct AI output. Their corrections are stored as cryptographic patches and replayed on future similar tasks.',
  },
  {
    id: 'welcome-4',
    role: 'system',
    ts: new Date().toISOString(),
    text: '**Royalties** are earned by validators every time their patch is reused. A validator who corrects a contract review today earns a fraction of every similar review forever.',
  },
  {
    id: 'welcome-5',
    role: 'system',
    ts: new Date().toISOString(),
    text: 'Type a command below to get started. Try: "submit task: review this contract" or "system status".',
  },
];

// ── Suggested commands for UNKNOWN intent ────────────────────────────────────
const SUGGESTED = [
  'submit task: <your task description>',
  'my balance',
  'pending approvals',
  'analyze: what is the system status',
  'system status',
  'calibrate model',
];

// ══════════════════════════════════════════════════════════════════════════════
// Inner chat component
// ══════════════════════════════════════════════════════════════════════════════
function ChatInner() {
  const { session, loaded, addMission, markWelcomeSeen, addConversationMessage } = useSession();

  const [messages, setMessages]         = useState([]);
  const [input, setInput]               = useState('');
  const [sending, setSending]           = useState(false);
  const [hintIdx, setHintIdx]           = useState(0);
  const [liveResult, setLiveResult]     = useState(null);
  const [calibratorStatus, setCalibratorStatus] = useState(null);
  const [tick, setTick]                 = useState(0); // for duration re-render

  const chatEndRef = useRef(null);
  const inputRef   = useRef(null);

  // ── Scroll to bottom on new messages ─────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Hint rotation every 8 seconds ────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setHintIdx(i => (i + 1) % HINT_SETS.length), 8000);
    return () => clearInterval(t);
  }, []);

  // ── Duration ticker every second ─────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Show welcome on first load ────────────────────────────────────────────
  useEffect(() => {
    if (!loaded) return;
    
    // Task 6: Check for ?welcome=true
    let isWelcome = false;
    try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        isWelcome = params.get('welcome') === 'true';
      }
    } catch (_) {}

    if (isWelcome) {
      const welcomeMsg = {
        id: 'welcome-special',
        role: 'system',
        ts: new Date().toISOString(),
        text: "Welcome to ECOS. You completed onboarding and earned ⊙1.25. Real tasks pay ⊙0.50–⊙5.00 each. Type 'pending approvals' to begin."
      };
      setMessages([welcomeMsg]);
    } else if (session?.isNew) {
      setMessages(WELCOME_MESSAGES);
      markWelcomeSeen();
    }
  }, [loaded, session?.isNew, markWelcomeSeen]);

  // ── Fetch calibrator status on mount ─────────────────────────────────────
  useEffect(() => {
    fetch(`${EXPRESS_BASE}/api/v1/calibrator`)
      .then(r => r.json())
      .then(d => setCalibratorStatus(d))
      .catch(() => setCalibratorStatus(null));
  }, []);

  // ── Push a message to the thread ─────────────────────────────────────────
  const pushMsg = useCallback((role, text, meta = {}) => {
    const msg = {
      id:   `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role,
      ts:   new Date().toISOString(),
      text,
      ...meta,
    };
    setMessages(prev => [...prev, msg]);
    if (addConversationMessage && (role === 'user' || role === 'assistant')) {
      addConversationMessage(role, text);
    }
    return msg;
  }, [addConversationMessage]);

  // ── API handlers ──────────────────────────────────────────────────────────

  async function handleTask(userText) {
    const taskText = userText.replace(/^(submit task|new mission|analyze|review)[:\s]*/i, '').trim() || userText;
    const body = {
      taskType:         'chat_mission',
      clientAccountId:  `client::${session?.sessionId?.slice(0, 8) || 'demo'}`,
      validatorAccountId: session?.validatorId || 'validator::demo_001',
      priceUsd:         '1.00',
      input:            { text: taskText },
    };

    pushMsg('system', '⏳ Submitting mission to ECOS engine…');

    const res = await fetch(`${EXPRESS_BASE}/api/v1/task`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (res.status === 410) {
      pushMsg('system',
        '⚠️ **Endpoint removed.** ' +
        (data.error || '') + ' ' +
        (data.docs ? '→ ' + data.docs : ''));
      return;
    }
    if (res.status >= 500) {
      pushMsg('system',
        '🔴 **Server error ' + res.status + ':** ' +
        (data.error || data.message || 'Unknown error'));
      return;
    }
    if (!res.ok) {
      pushMsg('system',
        '❌ **Request failed (' + res.status + '):** ' +
        (data.error || data.message || ''));
      return;
    }

    const verdict  = data.verdict || data.status || 'UNKNOWN';
    const approvalId = data.approvalId || data.approval_id || null;
    const missionId = data.missionId || approvalId || null;
    const amount   = data.priceUsd || data.amountUsd || null;
    const confidence = data.confidence != null ? `${(data.confidence * 100).toFixed(1)}%` : null;

    const vs = verdictStyle(verdict);
    let summary = `Verdict: **${verdict}**`;
    if (amount)     summary += ` · Amount: $${amount}`;
    if (approvalId) summary += ` · Approval ID: \`${approvalId}\``;
    if (missionId) summary += ` · Mission: \`${missionId}\``;
    if (confidence) summary += ` · Confidence: ${confidence}`;
    if (verdict === 'HITL_QUEUE') summary += '\n\n🟡 Awaiting validator review.';
    if (verdict === 'AUTO_FLOW')  summary += '\n\n✅ Processed automatically.';
    if (verdict === 'HARD_REJECT') summary += `\n\n🔴 Rejected: ${data.reason || 'unknown reason'}`;

    pushMsg('system', summary, { verdict, approvalId, missionId, amount, confidence });

    if (verdict === 'HITL_QUEUE' && approvalId) {
      setTimeout(() => {
        pushMsg('system', `💡 To approve this yourself: type 'approve ${approvalId}' or visit Validator view → /validator`, { approvalId, missionId });
      }, 1500);
    }

    setLiveResult({ verdict, approvalId, missionId, amount, confidence, raw: data, ts: new Date().toISOString() });

    addMission({
      id:         data.missionId || data.approvalId || `m-${Date.now()}`,
      missionId:  data.missionId || data.approvalId || null,
      ts:         new Date().toISOString(),
      text:       taskText,
      verdict,
      approvalId,
      amountUsd:  amount || '0.00',
    });
  }

  async function handleChat(userText) {
    const clientId = `client::${session?.sessionId?.slice(0, 8) || 'demo'}`;
    const priceUsd = '1.00';
    
    // Get last 5 messages from conversation history for context
    const contextHistory = (session?.conversationHistory || [])
      .slice(0, 5)
      .reverse()
      .map(msg => ({ role: msg.role, text: msg.text }));

    pushMsg('system', '🤖 Thinking…');

    const body = {
      text: userText,
      clientAccountId: clientId,
      priceUsd,
      context: { history: contextHistory },
    };

    try {
      const res = await fetch(`${EXPRESS_BASE}/api/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        pushMsg('system', `❌ Error: ${data.error || 'Unknown error'}`);
        return;
      }

      const { aiResponse, verdict, approvalId, confidence, missionId } = data;

      // Display AI response as primary content
      if (aiResponse) {
        pushMsg('assistant', aiResponse);
      } else {
        pushMsg('assistant', 'AI is processing…');
      }

      // Display verdict metadata
      const vs = verdictStyle(verdict);
      const confStr = confidence != null ? `${(confidence * 100).toFixed(1)}%` : 'N/A';
      let metadata = `\n\n─────────────────\nVerdict: **${verdict}** · Confidence: ${confStr}`;
      const missionLookupId = missionId || approvalId || null;
      if (approvalId) metadata += ` · ID: \`${approvalId}\``;
      if (missionLookupId) metadata += ` · Mission: \`${missionLookupId}\``;
      
      pushMsg('system', metadata, { verdict, approvalId, missionId: missionLookupId, confidence });

      if (verdict === 'HITL_QUEUE' && approvalId) {
        setTimeout(() => {
          pushMsg('system', `💡 To approve this yourself: type 'approve ${approvalId}' or visit Validator view → /validator`, { approvalId, missionId: missionLookupId });
        }, 1500);
      }

      setLiveResult({
        type: 'CHAT',
        verdict,
        approvalId,
        confidence,
        aiResponse,
        missionId,
        raw: data,
        ts: new Date().toISOString(),
      });
    } catch (err) {
      pushMsg('system', `❌ Chat error: ${err.message}`);
    }
  }


  async function handleBalance() {
    const accountId = `client::${session?.sessionId?.slice(0, 8) || 'demo'}`;
    pushMsg('system', `🔍 Fetching balance for \`${accountId}\`…`);
    const res  = await fetch(`${EXPRESS_BASE}/api/v1/account?id=${encodeURIComponent(accountId)}`);
    const data = await res.json();
    if (res.status === 410) {
      pushMsg('system',
        '⚠️ **Endpoint removed.** ' +
        (data.error || '') + ' ' +
        (data.docs ? '→ ' + data.docs : ''));
      return;
    }
    if (res.status >= 500) {
      pushMsg('system',
        '🔴 **Server error ' + res.status + ':** ' +
        (data.error || data.message || 'Unknown error'));
      return;
    }
    if (!res.ok) {
      pushMsg('system',
        '❌ **Request failed (' + res.status + '):** ' +
        (data.error || data.message || ''));
      return;
    }
    const bal  = data.balanceUsd ?? data.balance ?? '—';
    pushMsg('system', `💰 Balance: **$${bal}** for account \`${accountId}\``);
    setLiveResult({ type: 'BALANCE', accountId, balanceUsd: bal, raw: data, ts: new Date().toISOString() });
  }

  async function handleApprovals() {
    pushMsg('system', '🔍 Fetching pending approvals…');
    const res  = await fetch(`${EXPRESS_BASE}/api/v1/approvals?status=pending`);
    const data = await res.json();
    if (res.status === 410) {
      pushMsg('system',
        '⚠️ **Endpoint removed.** ' +
        (data.error || '') + ' ' +
        (data.docs ? '→ ' + data.docs : ''));
      return;
    }
    if (res.status >= 500) {
      pushMsg('system',
        '🔴 **Server error ' + res.status + ':** ' +
        (data.error || data.message || 'Unknown error'));
      return;
    }
    if (!res.ok) {
      pushMsg('system',
        '❌ **Request failed (' + res.status + '):** ' +
        (data.error || data.message || ''));
      return;
    }
    const list = data.approvals || data || [];
    const count = Array.isArray(list) ? list.length : '?';
    pushMsg('system', `📋 **${count}** pending approval(s) in queue.`);
    if (Array.isArray(list) && list.length > 0) {
      const lines = list.slice(0, 5).map(a =>
        `• \`${a.approvalId || a.id}\` — ${a.taskType || 'task'} · $${a.priceUsd || '?'}`
      ).join('\n');
      pushMsg('system', lines);
    }
    setLiveResult({ type: 'APPROVALS', count, list: Array.isArray(list) ? list.slice(0, 5) : [], raw: data, ts: new Date().toISOString() });
  }

  async function handleCalibrate() {
    pushMsg('system', '🔧 Fetching calibrator status…');
    const res  = await fetch(`${EXPRESS_BASE}/api/v1/calibrator`);
    const data = await res.json();
    setCalibratorStatus(data);
    const fitted  = data.fitted ? '✅ Fitted' : '⚠️ Not fitted';
    const samples = data.sampleCount ?? '?';
    const needed  = data.samplesNeeded ?? 50;
    pushMsg('system', `Calibrator: **${fitted}** · Samples: ${samples}/${needed} · ${data.nextStep || ''}`);
    setLiveResult({ type: 'CALIBRATOR', data, ts: new Date().toISOString() });
  }

  async function handleHealth() {
    // [V76] Fetch /api/v1/health and /api/v1/stats in parallel;
    // merge into one display. If either fails, show partial data from the other.
    let healthData = null;
    let statsData  = null;

    await Promise.allSettled([
      fetch(`${EXPRESS_BASE}/api/v1/health`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(d => { healthData = d; }),
      fetch(`${EXPRESS_BASE}/api/v1/stats`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(d => { statsData = d; }),
    ]);

    if (!healthData && !statsData) {
      pushMsg('system', '❌ Server unreachable: both /health and /stats failed');
      return;
    }

    // Prefer /api/v1/stats fields when available; fall back to /api/v1/health
    const version     = statsData?.version   ?? healthData?.version   ?? '?';
    const uptime      = statsData?.uptime    ?? healthData?.uptime    ?? '?';
    const calReady    = statsData?.calibrator?.ready      ?? healthData?.calibrator?.ready      ?? false;
    const calSamples  = statsData?.calibrator?.sampleCount ?? healthData?.calibrator?.sampleCount ?? 0;
    const chainLen    = statsData?.chain?.length  ?? healthData?.chain?.length  ?? '?';
    const chainHead   = statsData?.chain?.headHash ?? healthData?.chain?.headHash ?? 'empty';
    const platBal     = statsData?.ledger?.platformBalance  ?? null;
    const insBal      = statsData?.ledger?.insuranceBalance ?? null;
    const pending     = statsData?.approvals?.pending ?? statsData?.approvals?.all ?? '?';
    const total       = statsData?.approvals?.all     ?? statsData?.approvals?.total ?? '?';
    const db          = statsData?.db ?? healthData?.db ?? '?';
    const llm         = healthData?.llmProvider ?? process.env.NEXT_PUBLIC_LLM_PROVIDER ?? 'ollama';

    const lines = [
      `🟢 **Server V${version}** · Uptime: ${uptime}s`,
      `📊 Calibrator: ${calReady ? `ready (${calSamples} samples)` : `not ready (${calSamples}/50)`}`,
      `🔗 Chain: ${chainLen} entries · Head: ${chainHead}`,
    ];
    if (platBal !== null || insBal !== null) {
      lines.push(`💰 Platform: ${platBal ?? '—'} · Insurance: ${insBal ?? '—'}`);
    }
    lines.push(`📋 Queue: ${pending} pending · ${total} total`);
    lines.push(`💾 DB: ${db} · LLM: ${llm}`);

    pushMsg('system', lines.join('\n'));
    setLiveResult({ type: 'HEALTH', healthData, statsData, ts: new Date().toISOString() });
  }

  async function handleStatus() {
    pushMsg('system', '🔍 Checking system health…');
    const res  = await fetch(`${EXPRESS_BASE}/api/v1/verify`);
    const data = await res.json();
    const ok   = res.ok ? '✅ Healthy' : '⚠️ Degraded';
    pushMsg('system', `System: **${ok}** · Chain length: ${data.chainLength ?? '?'} · Entries: ${data.entryCount ?? '?'}`);
    setLiveResult({ type: 'STATUS', data, ts: new Date().toISOString() });
  }

  async function handleDeposit(userText) {
    // Parse amount from text: $100, 100.50, etc.
    const amountMatch = userText.match(/\$?(\d+(?:\.\d{1,2})?)/);
    if (!amountMatch) {
      pushMsg('system', '💳 Please specify an amount. Example: "deposit $100" or "add funds 50.00"');
      return;
    }
    const amount = amountMatch[1];
    const clientId = `client::${session?.sessionId?.slice(0, 8) || 'demo'}`;
    const idempKey = `chat-deposit-${session?.sessionId}-${Date.now()}`;
    
    pushMsg('system', `💳 Processing deposit of $${amount}…`);
    try {
      const res = await fetch(`${EXPRESS_BASE}/api/v1/deposit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          clientAccountId:  clientId,
          amountUsd:        amount,
          idempotencyKey:   idempKey,
        }),
      });
      const data = await res.json();
    if (res.status === 410) {
      pushMsg('system',
        '⚠️ **Endpoint removed.** ' +
        (data.error || '') + ' ' +
        (data.docs ? '→ ' + data.docs : ''));
      return;
    }
    if (res.status >= 500) {
      pushMsg('system',
        '🔴 **Server error ' + res.status + ':** ' +
        (data.error || data.message || 'Unknown error'));
      return;
    }
    if (!res.ok) {
      pushMsg('system',
        '❌ **Request failed (' + res.status + '):** ' +
        (data.error || data.message || ''));
      return;
    }
      if (res.ok) {
        pushMsg('system', `✅ Deposited **$${amount}**. New balance: **$${data.newBalanceUsd || data.balanceUsd || '?'}**`);
        setLiveResult({ type: 'DEPOSIT', amount, newBalance: data.newBalanceUsd || data.balanceUsd, ts: new Date().toISOString() });
      } else {
        pushMsg('system', `❌ Deposit failed: ${data.error || data.message || 'Unknown error'}`);
      }
    } catch (err) {
      pushMsg('system', `❌ Deposit error: ${err.message}`);
    }
  }

  async function handleResolve(userText, decision) {
    // Parse approval ID from text: apv_xxx. If omitted, helpfully inspect the pending queue.
    const idMatch = userText.match(/apv_[\w]+/);
    let approvalId = idMatch ? idMatch[0] : null;

    if (!approvalId) {
      pushMsg('system', '🔍 No approval ID supplied. Checking pending queue…');
      try {
        const pendingRes = await fetch(`${EXPRESS_BASE}/api/v1/approvals?status=pending`);
        const pendingData = await pendingRes.json();
        const pending = Array.isArray(pendingData.approvals) ? pendingData.approvals : [];

        if (pending.length === 0) {
          pushMsg('system', 'No pending approvals.');
          return;
        }

        if (pending.length > 1) {
          const lines = pending.slice(0, 10).map(a => `• \`${a.id || a.approvalId}\` — mission \`${a.missionId || '—'}\` · $${a.priceUsd || '?'}`).join('\n');
          pushMsg('system', `Multiple pending approvals found. Please choose one:\n\n${lines}\n\nExample: \`${decision} ${pending[0].id || pending[0].approvalId}\``);
          return;
        }

        approvalId = pending[0].id || pending[0].approvalId;
        pushMsg('system', `Exactly one pending approval found. Using \`${approvalId}\`.`);
      } catch (err) {
        pushMsg('system', `Could not inspect pending approvals: ${err.message}`);
        return;
      }
    }
    
    pushMsg('system', `⏳ ${decision === 'approve' ? 'Approving' : 'Rejecting'} \`${approvalId}\`…`);
    try {
      const res = await fetch(`${EXPRESS_BASE}/api/v1/approvals/${encodeURIComponent(approvalId)}/resolve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          validatorAccountId: session?.validatorId || 'validator::demo_001',
          decision,
          note: `${decision === 'approve' ? 'Approved' : 'Rejected'} via chat`,
        }),
      });
      const data = await res.json();
    if (res.status === 410) {
      pushMsg('system',
        '⚠️ **Endpoint removed.** ' +
        (data.error || '') + ' ' +
        (data.docs ? '→ ' + data.docs : ''));
      return;
    }
    if (res.status >= 500) {
      pushMsg('system',
        '🔴 **Server error ' + res.status + ':** ' +
        (data.error || data.message || 'Unknown error'));
      return;
    }
    if (!res.ok) {
      pushMsg('system',
        '❌ **Request failed (' + res.status + '):** ' +
        (data.error || data.message || ''));
      return;
    }
      if (res.ok) {
        const msg = decision === 'approve' 
          ? `✅ **Approved** \`${approvalId}\`. Validator balance: **$${data.validatorBalance || '?'}**`
          : `🔴 **Rejected** \`${approvalId}\`.`;
        pushMsg('system', msg);
        setLiveResult({ type: 'RESOLVE', approvalId, decision, balance: data.validatorBalance, ts: new Date().toISOString() });
      } else {
        pushMsg('system', `❌ ${decision === 'approve' ? 'Approval' : 'Rejection'} failed: ${data.error || data.message || 'Unknown error'}`);
      }
    } catch (err) {
      pushMsg('system', `❌ Error: ${err.message}`);
    }
  }

  function handleHistory() {
    const hist = session?.history || [];
    if (hist.length === 0) {
      pushMsg('system', '📋 No missions yet in this session.');
      return;
    }
    const rows = hist.slice(0, 10).map((m, i) => {
      const timeStr = fmtTime(m.ts);
      const taskStr = (m.text || '').substring(0, 40).replace(/\n/g, ' ');
      const verdict = m.verdict || '?';
      const amount = m.amountUsd || '0.00';
      return `${i+1}. ${timeStr} | ${taskStr}... | ${verdict} | $${amount}`;
    }).join('\n');
    pushMsg('system', `📋 **Last ${Math.min(10, hist.length)} missions:**\n\n\`\`\`\n${rows}\n\`\`\``);
    setLiveResult({ type: 'HISTORY', count: hist.length, ts: new Date().toISOString() });
  }

  async function handleDashboard() {
    pushMsg('system', '📊 Fetching system overview...');
    try {
      const [verifyRes, calibRes, approvalsRes] = await Promise.all([
        fetch(`${EXPRESS_BASE}/api/v1/verify`),
        fetch(`${EXPRESS_BASE}/api/v1/calibrator`),
        fetch(`${EXPRESS_BASE}/api/v1/approvals?status=all`),
      ]);
      const verify = await verifyRes.json();
      const calib = await calibRes.json();
      const approvals = await approvalsRes.json();
      const allApprovals = Array.isArray(approvals.approvals) ? approvals.approvals : [];
      const autoFlowCount = allApprovals.filter(a => a.verdict === 'AUTO_FLOW' || a.status === 'AUTO_FLOW').length;
      const hitlCount = allApprovals.filter(a => a.verdict === 'HITL_QUEUE' || a.status === 'HITL_QUEUE').length;
      const volumeUsd = allApprovals.reduce((sum, a) => sum + (parseFloat(a.priceUsd) || 0), 0);
      const summary = `**System Overview:** Chain is ${verify.ok ? '✅ intact' : '❌ broken'} (length: ${verify.chainLength || 0}). Calibrator is ${calib.fitted ? '✅ ready' : '⚠\ufe0f not ready'} (${calib.sampleCount || 0}/${calib.samplesNeeded || 50} samples). **${allApprovals.length}** total missions processed, **$${volumeUsd.toFixed(2)}** volume. **${autoFlowCount}** auto-approved, **${hitlCount}** pending human review.`;
      pushMsg('system', summary);
      pushMsg('system', '🔗 Open full dashboard: [/dashboard](/dashboard)');
      setLiveResult({ type: 'DASHBOARD', data: { verify, calib, allApprovals }, ts: new Date().toISOString() });
    } catch (err) {
      pushMsg('system', `❌ Dashboard fetch error: ${err.message}`);
    }
  }

  function handleMissionDetail(userText) {
    const idMatch = userText.match(/apv_[\w]+|mission[_:-]?[\w-]+|[a-z]+_[A-Za-z0-9_-]{6,}/i);
    if (!idMatch) {
      pushMsg('system', 'Please provide an approval ID. Example: `show mission apv_abc123`.');
      return;
    }
    const missionId = idMatch[0];
    pushMsg('system', `Opening mission detail → /mission/${missionId}`, { missionId });
    if (typeof window !== 'undefined') {
      window.open(`/mission/${encodeURIComponent(missionId)}`, '_blank');
    }
  }


  async function handleAgentTask(userText) {
    pushMsg('system', '🤖 Agent thinking…');
    try {
      const res = await fetch(`${EXPRESS_BASE}/api/v1/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: userText,
          clientAccountId: `client::${session?.sessionId?.slice(0, 8) || 'demo'}`,
          maxSteps: 5,
        }),
      });
      const data = await res.json();
    if (res.status === 410) {
      pushMsg('system',
        '⚠️ **Endpoint removed.** ' +
        (data.error || '') + ' ' +
        (data.docs ? '→ ' + data.docs : ''));
      return;
    }
    if (res.status >= 500) {
      pushMsg('system',
        '🔴 **Server error ' + res.status + ':** ' +
        (data.error || data.message || 'Unknown error'));
      return;
    }
    if (!res.ok) {
      pushMsg('system',
        '❌ **Request failed (' + res.status + '):** ' +
        (data.error || data.message || ''));
      return;
    }

      // Show thinking steps
      if (data.steps && data.steps.length > 0) {
        for (const s of data.steps) {
          if (s.type === 'tool') {
            pushMsg('system', `🛠️ Used tool: **${s.tool}** → ${JSON.stringify(s.result).slice(0, 80)}…`);
          } else if (s.type === 'think' && s.content && s.content.includes('action')) {
            pushMsg('system', `💭 Planning: ${s.content.slice(0, 100)}…`);
          }
        }
      }
      pushMsg('system', `🎯 **Agent answer:**\n\n${data.answer || 'No answer returned.'}`);
      setLiveResult({ type: 'AGENT', steps: data.stepCount, answer: data.answer, ts: new Date().toISOString() });
    } catch (e) {
      pushMsg('system', `❌ Agent error: ${e.message}`);
    }
  }

  async function handlePatchSearch(userText) {
    pushMsg('system', '🔍 Searching knowledge patches…');
    try {
      const res = await fetch(`${EXPRESS_BASE}/api/v1/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'find similar patches: ' + userText,
          clientAccountId: `client::${session?.sessionId?.slice(0, 8) || 'demo'}`,
          maxSteps: 5,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        pushMsg('system', `❌ Patch search failed: ${data.error || 'Unknown error'}`);
        return;
      }
      if (data.answer) {
        pushMsg('assistant', data.answer);
      } else {
        pushMsg('system', 'No patches found matching your query.');
      }
      setLiveResult({ type: 'PATCH_SEARCH', data, ts: new Date().toISOString() });
    } catch (e) {
      pushMsg('system', `❌ Patch search error: ${e.message}`);
    }
  }

  function handleUnknown(userText) {
    const suggestions = SUGGESTED.map(s => `• \`${s}\``).join('\n');
    pushMsg('system',
      `I didn't recognise a specific command in: _"${userText}"_\n\n` +
      `**Suggested commands:**\n${suggestions}`
    );
  }

  // ── [V54-P4] Help handler ──────────────────────────────────────────────────
  // [V79] METRICS intent — fetch /api/v1/metrics and display as table in chat
  async function handleMetrics() {
    try {
      const r = await fetch(`${EXPRESS_BASE}/api/v1/metrics`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      const rows = text.split('\n')
        .filter(line => /^ecos_\w+ [\d.]+$/.test(line.trim()))
        .map(line => {
          const [name, value] = line.trim().split(' ');
          return `| ${name} | ${value} |`;
        });
      const table = [
        '📡 **Live Metrics**',
        '',
        '| Metric | Value |',
        '|--------|-------|',
        ...rows,
      ].join('\n');
      pushMsg('system', table);
    } catch (err) {
      pushMsg('system', `❌ Metrics unavailable: ${err.message}`);
    }
    setLiveResult({ type: 'METRICS', ts: new Date().toISOString() });
  }

  // [V80] LEDGER intent — fetch /api/v1/stats and display ledger balances in chat
  async function handleLedger() {
    try {
      const r = await fetch(`${EXPRESS_BASE}/api/v1/stats`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const lines = [
        '💰 **Ledger Balances**',
        '',
        `Platform:  $${data.ledger?.platformBalance ?? 'N/A'}`,
        `Insurance: $${data.ledger?.insuranceBalance ?? 'N/A'}`,
      ];
      if (data.topValidators?.length > 0) {
        const top = data.topValidators[0];
        lines.push('', `🏆 Top validator: ${top.validatorId} — $${top.earnedUsd.toFixed(2)} earned (${top.taskCount} tasks)`);
      }
      pushMsg('system', lines.join('\n'));
    } catch (err) {
      pushMsg('system', `❌ Ledger unavailable: ${err.message}`);
    }
    setLiveResult({ type: 'LEDGER', ts: new Date().toISOString() });
  }

  function handleHelp() {
    pushMsg('system', [
      '**ECOS Commands — type any of these:**',
      '',
      '💬 **[any text]** — submit a task for AI review',
      '💰 **deposit $50** — add funds to your account',
      '✅ **approve apv_xxx** — approve a pending validation',
      '📋 **history** — show mission history',
      '📊 **dashboard** — system overview',
      '❤️ **health** — server status',
      '📡 **metrics** — live Prometheus gauges',
      '💰 **balance** — show ledger balances',
      '🔍 **find patches: query** — search knowledge patches',
      '🤖 **analyze: question** — deep agent analysis',
      '🆕 **pending** — show pending approval queue',
      '📦 **calibrate** — check calibrator status',
    ].join('\n'));
    setLiveResult({ type: 'HELP', ts: new Date().toISOString() });
  }

  // ── Send handler ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    pushMsg('user', text);
    setInput('');
    setSending(true);

    try {
      const intent = detectIntent(text);
      switch (intent) {
        case 'HEALTH':    await handleHealth();      break;
        case 'HELP':      handleHelp();              break;
        case 'METRICS':   await handleMetrics();     break;
        case 'LEDGER':    await handleLedger();      break;
        case 'TASK':      await handleTask(text);      break;
        case 'BALANCE':   await handleBalance();       break;
        case 'APPROVALS': await handleApprovals();     break;
        case 'CALIBRATE': await handleCalibrate();     break;
        case 'STATUS':    await handleStatus();        break;
        case 'DEPOSIT':   await handleDeposit(text);   break;
        case 'RESOLVE':   {
          const decision = /reject/i.test(text) ? 'reject' : 'approve';
          await handleResolve(text, decision);
          break;
        }
        case 'HISTORY':   handleHistory();             break;
        case 'MISSION_DETAIL': handleMissionDetail(text); break;
        case 'DASHBOARD': await handleDashboard();     break;
        case 'AGENT_TASK': await handleAgentTask(text); break;
        case 'PATCH_SEARCH': await handlePatchSearch(text); break;
        default:          await handleChat(text);
      }
    } catch (err) {
      pushMsg('system', `❌ Error: ${err.message}`);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending, session, pushMsg, addMission]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderMessageText(text) {
    // Very simple markdown: **bold**, `code`, _italic_, newlines
    return text
      .split('\n')
      .map((line, i) => {
        const parts = [];
        let rest = line;
        let key = 0;

        // Process inline patterns
        const patterns = [
          { re: /\*\*(.+?)\*\*/g, tag: 'strong' },
          { re: /`(.+?)`/g,       tag: 'code' },
          { re: /_(.+?)_/g,       tag: 'em' },
        ];

        // Simple sequential replacement
        const segments = [];
        let lastIdx = 0;
        const combined = /\*\*(.+?)\*\*|`(.+?)`|_(.+?)_/g;
        let m;
        while ((m = combined.exec(line)) !== null) {
          if (m.index > lastIdx) segments.push({ type: 'text', val: line.slice(lastIdx, m.index) });
          if (m[1] !== undefined) segments.push({ type: 'strong', val: m[1] });
          else if (m[2] !== undefined) segments.push({ type: 'code', val: m[2] });
          else if (m[3] !== undefined) segments.push({ type: 'em', val: m[3] });
          lastIdx = m.index + m[0].length;
        }
        if (lastIdx < line.length) segments.push({ type: 'text', val: line.slice(lastIdx) });

        const rendered = segments.map((seg, si) => {
          if (seg.type === 'strong') return <strong key={si}>{seg.val}</strong>;
          if (seg.type === 'code')   return <code key={si} style={S.inlineCode}>{seg.val}</code>;
          if (seg.type === 'em')     return <em key={si}>{seg.val}</em>;
          return <span key={si}>{seg.val}</span>;
        });

        return <div key={i} style={{ minHeight: '1.2em' }}>{rendered.length ? rendered : '\u00A0'}</div>;
      });
  }

  // ── Live result panel content ─────────────────────────────────────────────
  function renderLiveResult() {
    if (!liveResult) {
      return <div style={S.emptyPanel}>No result yet. Send a command to see output here.</div>;
    }

    const { verdict, approvalId, missionId, amount, confidence, type, data, ts } = liveResult;

    if (verdict) {
      const vs = verdictStyle(verdict);
      const isPulse = verdict === 'HITL_QUEUE';
      return (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{
              ...S.badge,
              background: vs.bg,
              color: vs.text,
              animation: isPulse ? 'pulse 1.5s ease-in-out infinite' : 'none',
            }}>
              {verdict}
            </span>
            <span style={{ color: '#9ca3af', fontSize: 12 }}>{fmtTime(ts)}</span>
          </div>
          {isPulse && (
            <div style={{ color: '#fcd34d', marginBottom: 8, fontSize: 13 }}>
              🟡 Awaiting validator review
              {approvalId && <span style={{ marginLeft: 8, color: '#9ca3af' }}>ID: <code style={S.inlineCode}>{approvalId}</code></span>}
            </div>
          )}
          {verdict === 'AUTO_FLOW' && (
            <div style={{ color: '#34d399', marginBottom: 8, fontSize: 13 }}>✅ Processed automatically</div>
          )}
          {verdict === 'HARD_REJECT' && (
            <div style={{ color: '#fca5a5', marginBottom: 8, fontSize: 13 }}>🔴 {liveResult.raw?.reason || 'Rejected'}</div>
          )}
          {amount     && <div style={S.resultRow}><span style={S.label}>Amount</span><span>${amount}</span></div>}
          {confidence && <div style={S.resultRow}><span style={S.label}>Confidence</span><span>{confidence}</span></div>}
          {approvalId && <div style={S.resultRow}><span style={S.label}>Approval ID</span><code style={S.inlineCode}>{approvalId}</code></div>}
          {(missionId || approvalId) && (
            <div style={S.resultRow}>
              <span style={S.label}>Mission audit</span>
              <a href={`/mission/${encodeURIComponent(missionId || approvalId)}`} style={S.missionLink}>Open detail →</a>
            </div>
          )}
        </div>
      );
    }

    if (type === 'BALANCE') {
      return (
        <div>
          <div style={{ ...S.badge, background: '#1e3a5f', color: '#93c5fd', marginBottom: 12 }}>BALANCE</div>
          <div style={S.resultRow}><span style={S.label}>Account</span><code style={S.inlineCode}>{liveResult.accountId}</code></div>
          <div style={S.resultRow}><span style={S.label}>Balance</span><span style={{ color: '#34d399', fontWeight: 600 }}>${liveResult.balanceUsd}</span></div>
        </div>
      );
    }

    if (type === 'APPROVALS') {
      return (
        <div>
          <div style={{ ...S.badge, background: '#78350f', color: '#fcd34d', marginBottom: 12 }}>APPROVALS</div>
          <div style={S.resultRow}><span style={S.label}>Pending</span><span>{liveResult.count}</span></div>
          {liveResult.list?.map((a, i) => (
            <div key={i} style={{ ...S.resultRow, fontSize: 12, color: '#9ca3af' }}>
              <code style={S.inlineCode}>{a.approvalId || a.id}</code>
              <span>${a.priceUsd || '?'}</span>
            </div>
          ))}
        </div>
      );
    }

    if (type === 'CALIBRATOR') {
      const d = liveResult.data || {};
      return (
        <div>
          <div style={{ ...S.badge, background: d.fitted ? '#064e3b' : '#374151', color: d.fitted ? '#34d399' : '#9ca3af', marginBottom: 12 }}>
            CALIBRATOR
          </div>
          <div style={S.resultRow}><span style={S.label}>Fitted</span><span>{d.fitted ? 'Yes' : 'No'}</span></div>
          <div style={S.resultRow}><span style={S.label}>Samples</span><span>{d.sampleCount ?? '?'} / {d.samplesNeeded ?? 50}</span></div>
          {d.nextStep && <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 8 }}>{d.nextStep}</div>}
        </div>
      );
    }

    if (type === 'STATUS') {
      const d = liveResult.data || {};
      return (
        <div>
          <div style={{ ...S.badge, background: '#064e3b', color: '#34d399', marginBottom: 12 }}>SYSTEM</div>
          <div style={S.resultRow}><span style={S.label}>Chain length</span><span>{d.chainLength ?? '?'}</span></div>
          <div style={S.resultRow}><span style={S.label}>Entries</span><span>{d.entryCount ?? '?'}</span></div>
        </div>
      );
    }

    if (type === 'DEPOSIT') {
      return (
        <div>
          <div style={{ ...S.badge, background: '#1e3a5f', color: '#93c5fd', marginBottom: 12 }}>DEPOSIT</div>
          <div style={S.resultRow}><span style={S.label}>Amount</span><span style={{ color: '#34d399', fontWeight: 600 }}>+${liveResult.amount}</span></div>
          {liveResult.newBalance && <div style={S.resultRow}><span style={S.label}>New balance</span><span>${liveResult.newBalance}</span></div>}
        </div>
      );
    }

    if (type === 'RESOLVE') {
      return (
        <div>
          <div style={{ ...S.badge, background: liveResult.decision === 'approve' ? '#064e3b' : '#7f1d1d', color: liveResult.decision === 'approve' ? '#34d399' : '#fca5a5', marginBottom: 12 }}>
            {liveResult.decision === 'approve' ? 'APPROVED' : 'REJECTED'}
          </div>
          <div style={S.resultRow}><span style={S.label}>Approval ID</span><code style={S.inlineCode}>{liveResult.approvalId}</code></div>
          {liveResult.balance && <div style={S.resultRow}><span style={S.label}>Validator balance</span><span>${liveResult.balance}</span></div>}
        </div>
      );
    }

    if (type === 'HISTORY') {
      return (
        <div>
          <div style={{ ...S.badge, background: '#1e3a5f', color: '#93c5fd', marginBottom: 12 }}>HISTORY</div>
          <div style={S.resultRow}><span style={S.label}>Total missions</span><span>{liveResult.count}</span></div>
        </div>
      );
    }

    if (type === 'DASHBOARD') {
      const d = liveResult.data || {};
      return (
        <div>
          <div style={{ ...S.badge, background: '#1e3a5f', color: '#93c5fd', marginBottom: 12 }}>DASHBOARD</div>
          {d.verify && <div style={S.resultRow}><span style={S.label}>Chain</span><span>{d.verify.ok ? 'Intact' : 'Broken'}</span></div>}
          {d.calib && <div style={S.resultRow}><span style={S.label}>Calibrator</span><span>{d.calib.fitted ? 'Ready' : 'Not ready'}</span></div>}
          {d.allApprovals && <div style={S.resultRow}><span style={S.label}>Total missions</span><span>{d.allApprovals.length}</span></div>}
        </div>
      );
    }

    if (type === 'PATCH_SEARCH') {
      return (
        <div>
          <div style={{ ...S.badge, background: '#1e3a5f', color: '#93c5fd', marginBottom: 12 }}>PATCH SEARCH</div>
          <div style={S.resultRow}><span style={S.label}>Query</span><span style={{ color: '#9ca3af', fontSize: 12 }}>see chat thread</span></div>
        </div>
      );
    }

    return <div style={S.emptyPanel}>Result received.</div>;
  }

  // ── Stats panel ───────────────────────────────────────────────────────────
  const missionCount = session?.history?.length ?? 0;
  const totalSpent   = session?.totalSpentUsd ?? '0.00';
  const duration     = fmtDuration(session?.sessionStart);
  const calReady     = calibratorStatus?.fitted;
  const calSamples   = calibratorStatus?.sampleCount ?? 0;

  const validatorLink = `/validator?validator=${encodeURIComponent(session?.validatorId || 'validator::demo_001')}`;

  // ── Render ────────────────────────────────────────────────────────────────
  if (!loaded) {
    return <div style={{ color: '#9ca3af', padding: 40 }}>Loading session…</div>;
  }

  return (
    <div style={S.root}>
      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
      `}</style>

      {/* ── LEFT: Chat thread ─────────────────────────────────────────────── */}
      <div style={S.leftPanel}>
        <div style={S.panelHeader}>
          <span style={S.panelTitle}>💬 Chat</span>
          <span style={{ color: '#6b7280', fontSize: 12 }}>Session: {session?.sessionId?.slice(0, 8)}…</span>
        </div>

        <div style={S.chatThread}>
          {messages.map(msg => (
            <div
              key={msg.id}
              style={{
                ...S.bubble,
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                background: msg.role === 'user' ? '#1d4ed8' : '#1f2937',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                maxWidth: '80%',
              }}
            >
              {msg.verdict && (
                <div style={{ marginBottom: 6 }}>
                  <span style={{
                    ...S.badge,
                    background: verdictStyle(msg.verdict).bg,
                    color:      verdictStyle(msg.verdict).text,
                    fontSize:   11,
                    padding:    '2px 8px',
                  }}>
                    {msg.verdict}
                  </span>
                  {msg.approvalId && (
                    <span style={{ marginLeft: 8, color: '#9ca3af', fontSize: 11 }}>
                      ID: {msg.approvalId.slice(0, 12)}…
                    </span>
                  )}
                  {(msg.missionId || msg.approvalId) && (
                    <a
                      href={`/mission/${encodeURIComponent(msg.missionId || msg.approvalId)}`}
                      style={{ ...S.missionLink, marginLeft: 8, fontSize: 11 }}
                    >
                      Mission detail →
                    </a>
                  )}
                </div>
              )}
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                {renderMessageText(msg.text)}
              </div>
              <div style={{ color: '#6b7280', fontSize: 11, marginTop: 4, textAlign: msg.role === 'user' ? 'right' : 'left' }}>
                {fmtTime(msg.ts)}
              </div>
            </div>
          ))}
          {sending && (
            <div style={{ ...S.bubble, alignSelf: 'flex-start', background: '#1f2937', color: '#9ca3af', fontSize: 13 }}>
              ⏳ Processing…
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* ── Input bar ────────────────────────────────────────────────────── */}
        <div style={S.inputArea}>
          {/* Hint row */}
          <div style={S.hintRow}>
            {HINT_SETS[hintIdx].map((hint, i) => (
              <button
                key={i}
                style={S.hintBtn}
                onClick={() => setInput(hint)}
              >
                {hint}
              </button>
            ))}
          </div>

          <div style={S.inputRow}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command or natural language…"
              rows={2}
              style={S.textarea}
              disabled={sending}
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              style={{
                ...S.sendBtn,
                opacity: (sending || !input.trim()) ? 0.5 : 1,
                cursor:  (sending || !input.trim()) ? 'not-allowed' : 'pointer',
              }}
            >
              {sending ? '…' : '▶'}
            </button>
          </div>

          {/* Validator quick-access */}
          <div style={{ textAlign: 'right', marginTop: 6 }}>
            <a href={validatorLink} style={S.validatorLink}>
              Switch to Validator view →
            </a>
          </div>

          {/* [V81] Session stats row — always visible below input bar */}
          <div style={{
            marginTop: 8,
            textAlign: 'center',
            fontSize: 11,
            color: '#6b7280',
            letterSpacing: '0.02em',
            userSelect: 'none',
          }}>
            Session:&nbsp;
            <span style={{ color: '#9ca3af' }}>{missionCount} mission{missionCount !== 1 ? 's' : ''}</span>
            &nbsp;·&nbsp;
            <span style={{ color: '#34d399' }}>${totalSpent} spent</span>
            &nbsp;·&nbsp;
            validator:&nbsp;
            <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>
              {session?.validatorId || 'validator::demo_001'}
            </span>
          </div>
        </div>
      </div>

      {/* ── RIGHT panels ──────────────────────────────────────────────────── */}
      <div style={S.rightCol}>

        {/* RIGHT TOP: Live output */}
        <div style={{ ...S.rightPanel, flex: '0 0 60%', overflowY: 'auto' }}>
          <div style={S.panelHeader}>
            <span style={S.panelTitle}>📡 Live Output</span>
            {liveResult?.ts && (
              <span style={{ color: '#6b7280', fontSize: 12 }}>{fmtTime(liveResult.ts)}</span>
            )}
          </div>
          <div style={{ padding: '0 16px 16px' }}>
            {renderLiveResult()}
          </div>
        </div>

        {/* RIGHT BOTTOM: Session stats */}
        <div style={{ ...S.rightPanel, flex: '0 0 40%', overflowY: 'auto' }}>
          <div style={S.panelHeader}>
            <span style={S.panelTitle}>📊 Session Stats</span>
          </div>
          <div style={{ padding: '0 16px 16px' }}>
            <div style={S.statRow}>
              <span style={S.label}>Missions sent</span>
              <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{missionCount}</span>
            </div>
            <div style={S.statRow}>
              <span style={S.label}>Total spent</span>
              <span style={{ color: '#34d399', fontWeight: 600 }}>${totalSpent}</span>
            </div>
            <div style={S.statRow}>
              <span style={S.label}>Session duration</span>
              <span style={{ color: '#e5e7eb' }}>{duration}</span>
            </div>
            <div style={S.statRow}>
              <span style={S.label}>Calibrator</span>
              <span style={{ color: calReady ? '#34d399' : '#fcd34d' }}>
                {calReady ? '✅ Ready' : '⚠️ Not ready'}
                {!calReady && calSamples > 0 && ` (${calSamples} samples)`}
              </span>
            </div>
            <div style={S.statRow}>
              <span style={S.label}>Session ID</span>
              <code style={{ ...S.inlineCode, fontSize: 11 }}>{session?.sessionId?.slice(0, 16)}…</code>
            </div>
            <div style={S.statRow}>
              <span style={S.label}>Validator</span>
              <code style={{ ...S.inlineCode, fontSize: 11 }}>{session?.validatorId}</code>
            </div>
          </div>
        </div>


      {/* PART B: Sliding Mission History Panel */}
      {showHistory && (
        <div style={{
          position: 'fixed',
          right: 0,
          top: '56px',
          height: 'calc(100vh - 56px)',
          width: '320px',
          background: '#0f172a',
          borderLeft: '1px solid #1f2937',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 10px rgba(0,0,0,0.3)',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px',
            borderBottom: '1px solid #1f2937',
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff', margin: 0 }}>
              Mission History
            </h3>
            <button
              onClick={() => setShowHistory(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#9ca3af',
                fontSize: 18,
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>

          {/* History List */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
          }}>
            {(!session?.history || session.history.length === 0) ? (
              <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                No missions yet
              </div>
            ) : (
              session.history.map((m, idx) => {
                const dateStr = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                const textStr = m.input?.text || m.text || '';
                const truncatedText = textStr.length > 35 ? textStr.substring(0, 35) + '...' : textStr;
                const verdict = m.verdict || m.status || 'UNKNOWN';
                const amount = m.priceUsd || m.amountUsd || '0.00';
                
                const verdictColor = (v) => {
                  switch (v.toUpperCase()) {
                    case 'AUTO_FLOW': return '#10b981';
                    case 'HITL_QUEUE': return '#f59e0b';
                    case 'HARD_REJECT': return '#ef4444';
                    default: return '#3b82f6';
                  }
                };

                return (
                  <div
                    key={m.id || idx}
                    onClick={() => window.open('/mission/' + (m.id || m.missionId), '_blank')}
                    style={{
                      padding: '12px',
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      marginBottom: '8px',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#1e293b'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>{dateStr}</span>
                      <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>${amount}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#e2e8f0', marginBottom: '8px', wordBreak: 'break-word' }}>
                      {truncatedText}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <span style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        color: '#fff',
                        backgroundColor: verdictColor(verdict),
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}>
                        {verdict}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Default export — wraps with SessionProvider
// ══════════════════════════════════════════════════════════════════════════════
export default function ChatPage() {
  return (
    <SessionProvider>
      <ChatInner />
    </SessionProvider>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Styles
// ══════════════════════════════════════════════════════════════════════════════
const S = {
  root: {
    display:        'flex',
    flexDirection:  'row',
    height:         'calc(100vh - 56px)', // leave room for nav
    background:     '#111827',
    color:          '#e5e7eb',
    fontFamily:     '"Inter", "Segoe UI", system-ui, sans-serif',
    overflow:       'hidden',
  },
  leftPanel: {
    display:        'flex',
    flexDirection:  'column',
    width:          '55%',
    borderRight:    '1px solid #1f2937',
    minWidth:       0,
  },
  rightCol: {
    display:        'flex',
    flexDirection:  'column',
    width:          '45%',
    minWidth:       0,
  },
  rightPanel: {
    display:        'flex',
    flexDirection:  'column',
    borderBottom:   '1px solid #1f2937',
  },
  panelHeader: {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
    padding:        '12px 16px',
    borderBottom:   '1px solid #1f2937',
    background:     '#0f172a',
    flexShrink:     0,
  },
  panelTitle: {
    fontWeight:     600,
    fontSize:       14,
    color:          '#e5e7eb',
    letterSpacing:  '0.02em',
  },
  chatThread: {
    flex:           1,
    overflowY:      'auto',
    padding:        '16px',
    display:        'flex',
    flexDirection:  'column',
    gap:            10,
  },
  bubble: {
    padding:        '10px 14px',
    color:          '#e5e7eb',
    wordBreak:      'break-word',
  },
  inputArea: {
    padding:        '12px 16px',
    borderTop:      '1px solid #1f2937',
    background:     '#0f172a',
    flexShrink:     0,
  },
  hintRow: {
    display:        'flex',
    gap:            8,
    marginBottom:   8,
    flexWrap:       'wrap',
  },
  hintBtn: {
    background:     '#1f2937',
    border:         '1px solid #374151',
    borderRadius:   20,
    color:          '#9ca3af',
    fontSize:       11,
    padding:        '3px 10px',
    cursor:         'pointer',
    transition:     'background 0.15s',
  },
  inputRow: {
    display:        'flex',
    gap:            8,
    alignItems:     'flex-end',
  },
  textarea: {
    flex:           1,
    background:     '#1f2937',
    border:         '1px solid #374151',
    borderRadius:   8,
    color:          '#e5e7eb',
    fontSize:       14,
    padding:        '8px 12px',
    resize:         'none',
    outline:        'none',
    fontFamily:     'inherit',
    lineHeight:     1.5,
  },
  sendBtn: {
    background:     '#1d4ed8',
    border:         'none',
    borderRadius:   8,
    color:          '#fff',
    fontSize:       18,
    width:          44,
    height:         44,
    cursor:         'pointer',
    flexShrink:     0,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
  },
  validatorLink: {
    color:          '#6b7280',
    fontSize:       12,
    textDecoration: 'none',
    transition:     'color 0.15s',
  },
  missionLink: {
    color:          '#93c5fd',
    fontSize:       12,
    fontWeight:     700,
    textDecoration: 'none',
  },
  badge: {
    display:        'inline-block',
    padding:        '3px 10px',
    borderRadius:   20,
    fontSize:       12,
    fontWeight:     700,
    letterSpacing:  '0.05em',
  },
  resultRow: {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
    padding:        '5px 0',
    borderBottom:   '1px solid #1f2937',
    fontSize:       13,
    gap:            12,
  },
  statRow: {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
    padding:        '6px 0',
    borderBottom:   '1px solid #1f2937',
    fontSize:       13,
  },
  label: {
    color:          '#6b7280',
    fontSize:       12,
  },
  inlineCode: {
    background:     '#374151',
    borderRadius:   4,
    padding:        '1px 5px',
    fontFamily:     '"Fira Mono", "Consolas", monospace',
    fontSize:       12,
    color:          '#93c5fd',
  },
  emptyPanel: {
    color:          '#6b7280',
    fontSize:       13,
    fontStyle:      'italic',
    padding:        '8px 0',
  },
};
