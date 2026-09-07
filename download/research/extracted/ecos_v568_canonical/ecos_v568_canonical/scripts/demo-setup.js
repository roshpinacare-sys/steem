#!/usr/bin/env node
/**
 * demo-setup.js — ECOS V142
 * ─────────────────────────────────────────────────────────────────────────────
 * [V142-DEMO-01] Design-partner demo environment setup.
 *
 * Seeds realistic, plausible demo data into a running ECOS instance so a
 * prospect can immediately see:
 *   1. Live audit chain with 20 entries
 *   2. Mixed AUTO_FLOW + HITL tasks with realistic confidence scores
 *   3. 3 validators with reputation scores and activity
 *   4. Compliance report pre-generated
 *   5. Onboarding readiness check run
 *
 * Usage:
 *   node scripts/demo-setup.js [--api http://localhost:3000] [--vertical insurance]
 *   node scripts/demo-setup.js --dry-run   (prints what would happen, no HTTP calls)
 *
 * Requirements:
 *   - ECOS server running (default: http://localhost:3000)
 *   - VALIDATOR_API_KEY set (or pass via --key)
 *
 * [V142-DEMO-01] Initial implementation
 */

'use strict';

const https = require('node:https');
const http  = require('node:http');

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const API_BASE    = (args[args.indexOf('--api')   + 1] || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const VERTICAL    = args[args.indexOf('--vertical') + 1] || 'insurance';
const API_KEY     = args[args.indexOf('--key')    + 1] || process.env.VALIDATOR_API_KEY || 'demo-key';
const DRY_RUN     = args.includes('--dry-run');
const QUIET       = args.includes('--quiet');

function log(...a) { if (!QUIET) console.log(...a); }

// ── HTTP helper ────────────────────────────────────────────────────────────
async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const lib = url.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = lib.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Validator-Key': API_KEY,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Demo data definitions ──────────────────────────────────────────────────

const VALIDATORS = [
  {
    displayName: 'Sarah Chen — Insurance Claims Expert',
    email: 'demo-validator-sarah@ecos-demo.invalid',
    domainExpertise: ['insurance', 'property', 'liability'],
    tier: 'DOMAIN_EXPERT',
  },
  {
    displayName: 'James O\'Brien — Legal Document Reviewer',
    email: 'demo-validator-james@ecos-demo.invalid',
    domainExpertise: ['legal', 'contract', 'compliance'],
    tier: 'DOMAIN_EXPERT',
  },
  {
    displayName: 'Priya Nair — AI Auditor',
    email: 'demo-validator-priya@ecos-demo.invalid',
    domainExpertise: ['audit', 'ai-safety', 'compliance'],
    tier: 'VALIDATOR',
  },
];

const TASKS = {
  insurance: [
    { prompt: 'Review auto insurance claim #CL-2841: vehicle collision, $12,400 repair estimate. Policy: comprehensive, no fault exclusion. Recommend settlement.',                              expectedConfidence: 0.82, verdict: 'AUTO_FLOW' },
    { prompt: 'Homeowner claim #CL-2842: flood damage reported 72h after storm. Policy: standard, flood excluded unless separate rider. Rider present in file.',                               expectedConfidence: 0.58, verdict: 'HITL_QUEUE' },
    { prompt: 'Medical claim #CL-2843: physiotherapy sessions post-accident. 12 sessions invoiced, 8 covered by standard policy. Recommend partial approval for 8 sessions.',                expectedConfidence: 0.91, verdict: 'AUTO_FLOW' },
    { prompt: 'Business interruption claim #CL-2844: restaurant closed 3 weeks due to fire suppression system activation. $89,000 lost revenue claimed. Policy limit $75,000.',              expectedConfidence: 0.51, verdict: 'HITL_QUEUE' },
    { prompt: 'Personal injury claim #CL-2845: claimant reports soft tissue injury from minor rear-end collision. $4,200 medical bills + $15,000 pain and suffering.',                        expectedConfidence: 0.44, verdict: 'HITL_QUEUE' },
    { prompt: 'Auto total loss claim #CL-2846: 2019 sedan, pre-loss ACV $18,500, salvage value $3,200. Policy: comprehensive. Settlement: $15,300.',                                         expectedConfidence: 0.88, verdict: 'AUTO_FLOW' },
    { prompt: 'Workers comp claim #CL-2847: warehouse worker, back injury, 4 weeks off. Employer confirms accident. $6,400 wage replacement + $2,100 medical.',                              expectedConfidence: 0.79, verdict: 'AUTO_FLOW' },
    { prompt: 'Fraud flag on claim #CL-2848: same claimant filed 3 similar claims in 18 months, different vehicles, same workshop. Investigate before proceeding.',                          expectedConfidence: 0.22, verdict: 'BLOCK' },
    { prompt: 'Life insurance claim #CL-2849: beneficiary claim, death certificate attached, 2-year contestability period expired. Straightforward: approve $250,000 benefit.',              expectedConfidence: 0.95, verdict: 'AUTO_FLOW' },
    { prompt: 'Property damage claim #CL-2850: burst pipe, $8,900 remediation. Pre-existing water stain visible in photos — adjuster unsure if related. Needs human review.',               expectedConfidence: 0.53, verdict: 'HITL_QUEUE' },
  ],
  legal: [
    { prompt: 'Review SaaS Master Service Agreement v3.2: identify any unlimited liability clauses, uncapped indemnification, or IP assignment risks.',                                       expectedConfidence: 0.72, verdict: 'AUTO_FLOW' },
    { prompt: 'Employment contract review: non-compete clause covers global geography for 5 years in all technology sectors. Enforceability analysis needed.',                               expectedConfidence: 0.49, verdict: 'HITL_QUEUE' },
    { prompt: 'NDA review: mutual, 3-year term, standard exclusions, residuals clause included. Low risk — recommend approval with minor redline on residuals.',                             expectedConfidence: 0.87, verdict: 'AUTO_FLOW' },
    { prompt: 'Merger agreement: material adverse change clause — broad definition includes geopolitical events. Assess risk in current regulatory environment.',                             expectedConfidence: 0.41, verdict: 'HITL_QUEUE' },
    { prompt: 'Vendor agreement DPA: GDPR Article 28 compliant, sub-processor list attached, 72h breach notification, standard contractual clauses included.',                               expectedConfidence: 0.93, verdict: 'AUTO_FLOW' },
  ],
};

// ── Demo setup runner ──────────────────────────────────────────────────────

async function runDemoSetup() {
  log('\n╔════════════════════════════════════════════════════════════╗');
  log('║      ECOS V142 — Design Partner Demo Setup                ║');
  log('╚════════════════════════════════════════════════════════════╝\n');
  log(`  API Base  : ${API_BASE}`);
  log(`  Vertical  : ${VERTICAL}`);
  log(`  Dry Run   : ${DRY_RUN}`);
  log('');

  const tasks = TASKS[VERTICAL] || TASKS.insurance;
  const results = { validators: [], tasks: [], errors: [] };

  // ── Step 1: Health check ─────────────────────────────────────────────────
  log('Step 1: Health check...');
  if (!DRY_RUN) {
    try {
      const h = await request('GET', '/api/v1/health');
      if (h.status === 200) {
        log(`         ✅ Server OK — version ${h.body.version || '?'}, uptime ${h.body.uptime || '?'}s`);
      } else {
        log(`         ⚠️  Health returned ${h.status} — proceeding anyway`);
      }
    } catch (err) {
      log(`         ❌ Cannot reach ${API_BASE} — is the server running?`);
      log(`            Error: ${err.message}`);
      process.exit(1);
    }
  } else {
    log('         [DRY RUN] Skipped');
  }

  // ── Step 2: Seed validators ──────────────────────────────────────────────
  log('\nStep 2: Seed demo validators...');
  for (const v of VALIDATORS) {
    log(`         → ${v.displayName}`);
    if (!DRY_RUN) {
      try {
        const r = await request('POST', '/api/v1/users/signup', {
          email: v.email,
          displayName: v.displayName,
          metadata: { domainExpertise: v.domainExpertise, tier: v.tier, isDemo: true },
        });
        if (r.status === 200 || r.status === 201) {
          results.validators.push({ ...v, userId: r.body.userId, accountId: r.body.accountId });
          log(`           ✅ Created userId=${r.body.userId}`);
        } else if (r.status === 409 || (r.body && r.body.error && r.body.error.includes('exist'))) {
          log(`           ℹ️  Already exists — skipping`);
        } else {
          log(`           ⚠️  Unexpected status ${r.status}`);
        }
      } catch (err) {
        log(`           ⚠️  Error: ${err.message}`);
        results.errors.push({ step: 'validator', name: v.displayName, error: err.message });
      }
    }
  }

  // ── Step 3: Submit tasks ─────────────────────────────────────────────────
  log(`\nStep 3: Submit ${tasks.length} demo ${VERTICAL} tasks...`);
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const label = `Task ${i + 1}/${tasks.length} [expected: ${t.verdict}]`;
    log(`         → ${label}`);
    if (!DRY_RUN) {
      try {
        const r = await request('POST', '/api/v1/task', {
          input: t.prompt,
          clientAccountId: 'demo::design-partner',
          metadata: { vertical: VERTICAL, demoTask: true, taskIndex: i + 1 },
        });
        if (r.status === 200 || r.status === 201 || r.status === 202) {
          const verdict = r.body.verdict || r.body.status || '?';
          results.tasks.push({ index: i + 1, verdict });
          log(`           ✅ verdict=${verdict}, confidence=${r.body.confidence ?? '?'}`);
        } else {
          log(`           ⚠️  Status ${r.status}: ${JSON.stringify(r.body).slice(0, 80)}`);
        }
      } catch (err) {
        log(`           ⚠️  Error: ${err.message}`);
        results.errors.push({ step: 'task', index: i + 1, error: err.message });
      }
    } else {
      log(`           [DRY RUN] Would POST: "${t.prompt.slice(0, 60)}..."`);
    }
  }

  // ── Step 4: Generate compliance report ───────────────────────────────────
  log('\nStep 4: Generate EU AI Act compliance report...');
  if (!DRY_RUN) {
    try {
      const r = await request('GET', `/api/v1/audit/operator-report?operatorName=ECOS+Demo&operatorContact=demo%40ecos.ai&verticals=${VERTICAL}`);
      if (r.status === 200) {
        const status = r.body.overallStatus || '?';
        const issues = (r.body.openIssues || []).length;
        log(`         ✅ Report generated — status=${status}, openIssues=${issues}`);
      } else {
        log(`         ⚠️  Report returned ${r.status}`);
      }
    } catch (err) {
      log(`         ⚠️  Error: ${err.message}`);
    }
  } else {
    log('         [DRY RUN] Would GET /api/v1/audit/operator-report');
  }

  // ── Step 5: Run onboarding readiness check ───────────────────────────────
  log('\nStep 5: Run onboarding readiness check...');
  if (!DRY_RUN) {
    try {
      const r = await request('GET', '/api/v1/onboarding/readiness');
      if (r.status === 200) {
        const { ready, score, blockers } = r.body;
        log(`         ${ready ? '✅' : '⚠️ '} Ready=${ready}, Score=${score}%, Blockers=${(blockers || []).length}`);
        if (blockers && blockers.length > 0) {
          blockers.slice(0, 3).forEach(b => log(`           ⛔ ${b}`));
        }
      } else {
        log(`         ⚠️  Readiness check returned ${r.status}`);
      }
    } catch (err) {
      log(`         ⚠️  Error: ${err.message}`);
    }
  } else {
    log('         [DRY RUN] Would GET /api/v1/onboarding/readiness');
  }

  // ── Step 6: Chain integrity check ────────────────────────────────────────
  log('\nStep 6: Verify audit chain...');
  if (!DRY_RUN) {
    try {
      const r = await request('GET', '/api/v1/chain/proof');
      if (r.status === 200) {
        const intact = r.body.intact !== false;
        log(`         ${intact ? '✅' : '❌'} Chain intact=${intact}, headHash=${(r.body.headHash || r.body.head || '').slice(0, 16)}...`);
      } else {
        log(`         ⚠️  Chain proof returned ${r.status}`);
      }
    } catch (err) {
      log(`         ⚠️  Error: ${err.message}`);
    }
  } else {
    log('         [DRY RUN] Would GET /api/v1/chain/proof');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  log('\n╔════════════════════════════════════════════════════════════╗');
  log('║                   Demo Setup Complete                     ║');
  log('╚════════════════════════════════════════════════════════════╝\n');
  log(`  Validators seeded  : ${DRY_RUN ? VALIDATORS.length + ' (dry run)' : results.validators.length}`);
  log(`  Tasks submitted    : ${DRY_RUN ? tasks.length + ' (dry run)' : results.tasks.length}`);
  log(`  Errors encountered : ${results.errors.length}`);
  log('');
  log('  Demo URLs:');
  log(`    Dashboard  : ${API_BASE.replace(':3000', ':3001')}/dashboard`);
  log(`    Chain      : ${API_BASE.replace(':3000', ':3001')}/chain`);
  log(`    Compliance : ${API_BASE}/api/v1/audit/operator-report?format=markdown`);
  log(`    PDF Export : ${API_BASE}/api/v1/audit/operator-report?format=html`);
  log(`    Readiness  : ${API_BASE}/api/v1/onboarding/readiness`);
  log('');
  log('  Next steps for design partner call:');
  log('    1. Share the dashboard URL — they can see live tasks in real-time');
  log('    2. Show /chain — immutable audit trail (EU AI Act Art. 12 evidence)');
  log('    3. Export compliance report PDF — hand to their legal/compliance team');
  log('    4. Run a live task submission during the call\n');

  if (results.errors.length > 0) {
    log('  ⚠️  Some steps had errors (non-fatal). Server may be partially configured.');
    results.errors.forEach(e => log(`     - ${e.step}: ${e.error}`));
    log('');
  }

  process.exit(results.errors.length > 2 ? 1 : 0);
}

runDemoSetup().catch(err => {
  console.error('\n[demo-setup] Fatal error:', err.message);
  process.exit(1);
});
