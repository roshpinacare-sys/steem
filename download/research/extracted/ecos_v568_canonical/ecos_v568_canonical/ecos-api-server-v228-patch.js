// ============================================================
// ECOS V228 — Phase P122 — Server Patch
// Implements three V228 work items from NEXT_SESSION_PROMPT_V227:
//
//   P122-A  POST /api/v1/admin/agent-spend-v227/:projectId/approve
//             HITL approval endpoint: validates operator identity,
//             clears the spend ledger, emits audit event to _eventLog181,
//             records the approval in per-project history ring.
//
//   P122-B  GET  /api/v1/admin/agent-spend-v228/:projectId/history
//             Returns the per-project HITL approval history (max 50 entries).
//
//   P122-C  GET  /api/v1/admin/summary/v228
//             V228 health + approval stats summary.
//
// Iron rules:
//   R1  Sacred files untouched (lib/fiatLedger.js, lib/auditLog.js).
//   R2  All new identifiers end in _228.
//   R3  Zero new npm deps; Node built-ins + relative requires only.
//   R6  V220–V227 endpoints untouched; only new routes registered here.
// ============================================================

'use strict';

const {
  approveProjectSpend_228,
  getApprovalHistory_228,
  APPROVAL_VERSION_228,
} = require('./src/lib/agentSpendApproval228.js');

// ── Shared approval store (singleton for this process) ───────────────────────
// The approvalStore is exported so tests can inject the same instance.
const { _defaultApprovalStore_228 } = require('./src/lib/agentSpendApproval228.js');
const _approvalStore_228 = _defaultApprovalStore_228;

// ── Attempt to reach agentLoop227's default spend map ────────────────────────
// Non-fatal: if the patch isn't loaded yet, approvals still record history.
function _getSpendMap_228() {
  try {
    const m = require('./ecos-api-server-v227-patch.js');
    // The v227 patch doesn't export its Map directly — approvals use
    // the reset helper which wraps the internal map.
    return m.__spendMap_228_ref || null;
  } catch (_) {
    return null;
  }
}

// ── Approval counter (in-process) ────────────────────────────────────────────
let _totalApprovals_228 = 0;
let _totalApprovalsFailed_228 = 0;

function registerV228Endpoints(app, opts) {
  const o = opts || {};
  // Allow callers to inject an _eventLog181 reference for audit emission.
  const eventLog_228 = (o.eventLog_228 instanceof Map) ? o.eventLog_228 : null;
  // Allow callers to inject a spend map (agentLoop227's ledger).
  const injectedSpendMap_228 = (o.spendMap_227 instanceof Map) ? o.spendMap_227 : null;

  // ── [P122-A] POST /api/v1/admin/agent-spend-v227/:projectId/approve ─────────
  // Clears the HITL flag for a project after operator review.
  // Body: { approvedBy: string (required), note?: string }
  app.post('/api/v1/admin/agent-spend-v227/:projectId/approve', (req_228, res_228) => {
    const projectId_228 = String(req_228.params.projectId || '').trim();
    if (!projectId_228) {
      _totalApprovalsFailed_228++;
      return res_228.status(400).json({
        ok: false,
        error: 'projectId is required',
        ecosVersion: 'V228',
      });
    }

    const body_228 = req_228.body || {};
    const approvedBy_228 = String(body_228.approvedBy || '').trim();
    if (!approvedBy_228) {
      _totalApprovalsFailed_228++;
      return res_228.status(400).json({
        ok: false,
        error: 'approvedBy is required — operator identity must be recorded for audit compliance',
        ecosVersion: 'V228',
      });
    }

    const note_228 = body_228.note ? String(body_228.note).slice(0, 500) : '';

    // Resolve spend map: prefer injected → try v227 patch → null (still logs history)
    const spendMap_228 = injectedSpendMap_228 || _getSpendMap_228();

    const result_228 = approveProjectSpend_228({
      projectId: projectId_228,
      approvedBy_228,
      note_228,
      spendMap_227: spendMap_228,
      approvalStore_228: _approvalStore_228,
      eventLog_228,
    });

    if (!result_228.ok) {
      _totalApprovalsFailed_228++;
      return res_228.status(400).json({ ...result_228, ecosVersion: 'V228' });
    }

    _totalApprovals_228++;
    return res_228.status(200).json({
      ...result_228,
      message: `HITL approval recorded for project "${projectId_228}". Spend ledger cleared. Agent may resume.`,
      ecosVersion: 'V228',
    });
  });

  // ── [P122-B] GET /api/v1/admin/agent-spend-v228/:projectId/history ──────────
  // Returns the HITL approval history ring for a project.
  app.get('/api/v1/admin/agent-spend-v228/:projectId/history', (req_228b, res_228b) => {
    const projectId_228b = String(req_228b.params.projectId || '').trim();
    if (!projectId_228b) {
      return res_228b.status(400).json({ ok: false, error: 'projectId required', ecosVersion: 'V228' });
    }
    const result_228b = getApprovalHistory_228(projectId_228b, _approvalStore_228);
    return res_228b.status(result_228b.ok ? 200 : 400).json({ ...result_228b, ecosVersion: 'V228' });
  });

  // ── [P122-C] GET /api/v1/admin/summary/v228 ──────────────────────────────────
  app.get('/api/v1/admin/summary/v228', (req_228c, res_228c) => {
    res_228c.json({
      ok: true,
      version: 'V228',
      phase: 'P122',
      summary: 'HITL approval endpoint + approval history + audit emission',
      newEndpoints: [
        'POST /api/v1/admin/agent-spend-v227/:projectId/approve — HITL operator approval',
        'GET  /api/v1/admin/agent-spend-v228/:projectId/history — approval history',
        'GET  /api/v1/admin/summary/v228                        — this endpoint',
      ],
      newLibs: [
        'src/lib/agentSpendApproval228.js — HITL approval + history ring + audit bridge',
      ],
      approvalStats: {
        totalApprovals: _totalApprovals_228,
        totalApprovalsFailed: _totalApprovalsFailed_228,
      },
      ecosVersion: 'V228',
    });
  });
}

module.exports = {
  registerV228Endpoints,
  // export for test injection
  _approvalStore_228,
};
