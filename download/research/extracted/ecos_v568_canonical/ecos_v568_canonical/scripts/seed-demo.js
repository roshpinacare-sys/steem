#!/usr/bin/env node
/**
 * ECOS Demo Seeder — V117 STR-06
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeds realistic Insurance Claims demo data for design partner calls.
 * 
 * Creates:
 *   • 5 demo validators (beginner + senior profiles)
 *   • 20 realistic insurance claim tasks
 *   • 10 HITL approval entries
 *   • 3 golden task submissions
 *   • 2 stablecoin deposits
 * 
 * Usage:
 *   node scripts/seed-demo.js [--base-url http://localhost:3000] [--scenario insurance_claims]
 *   npm run demo:seed
 */

'use strict';

const https = require('node:https');
const http  = require('node:http');

const BASE_URL = process.env.ECOS_DEMO_BASE_URL || (process.argv.find(a => a.startsWith('--base-url='))?.split('=')[1]) || 'http://localhost:3000';
const SCENARIO = process.env.ECOS_DEMO_SCENARIO  || (process.argv.find(a => a.startsWith('--scenario='))?.split('=')[1]) || 'insurance_claims';

const NUM_VALIDATORS = parseInt(process.env.ECOS_DEMO_VALIDATORS || '5', 10);
const NUM_TASKS      = parseInt(process.env.ECOS_DEMO_TASKS      || '20', 10);

// ── Helpers ────────────────────────────────────────────────────────────────

function request(method, url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod    = parsed.protocol === 'https:' ? https : http;
    const opts   = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = mod.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function post(path, body) {
  return request('POST', `${BASE_URL}${path}`, body);
}

async function get(path) {
  return request('GET', `${BASE_URL}${path}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Insurance Claims Data ─────────────────────────────────────────────────

const INSURANCE_CLAIMS = [
  { instruction: 'Validate water damage claim #IC-2024-001: Customer reports burst pipe causing $8,400 in damage. Policy #H-44921. Review photos and estimate.', priceUsd: '2.50', domain: 'insurance' },
  { instruction: 'Review auto collision claim #AC-2024-055: Rear-end collision at traffic light. Claimant: $3,200 repair estimate. Counter-party denies fault. Assess liability.', priceUsd: '3.00', domain: 'insurance' },
  { instruction: 'Assess fire damage claim #FD-2024-009: Kitchen fire in rental property. Landlord claims $22,000 in structural damage. Tenant disputes pre-existing damage vs fire damage.', priceUsd: '4.00', domain: 'insurance' },
  { instruction: 'Validate medical malpractice claim #MM-2024-033: Post-surgical complication. Policy limit $500k. Review medical records for causation link.', priceUsd: '5.00', domain: 'legal' },
  { instruction: 'Review personal injury claim #PI-2024-077: Slip-and-fall at commercial property. Claimant reports herniated disc. Evaluate medical evidence.', priceUsd: '3.50', domain: 'insurance' },
  { instruction: 'Assess storm damage claim #SD-2024-112: Hurricane-force winds. Roof and window damage. $14,600 contractor estimate. Verify coverage under Section 3B.', priceUsd: '2.50', domain: 'insurance' },
  { instruction: 'Validate business interruption claim #BI-2024-004: Restaurant closed 3 weeks after kitchen fire. Claims $45,000 in lost revenue. Review financial records.', priceUsd: '5.00', domain: 'insurance' },
  { instruction: 'Review motorcycle accident claim #MA-2024-088: Total loss, $11,200 market value. Claimant disputes adjuster valuation. Assess comparable market data.', priceUsd: '2.00', domain: 'insurance' },
  { instruction: 'Assess flood damage claim #FL-2024-019: Basement flooding from municipal drainage backup. $31,000 in damages claimed. Check exclusion clauses.', priceUsd: '3.00', domain: 'insurance' },
  { instruction: 'Validate workers compensation claim #WC-2024-221: Repetitive strain injury, warehouse worker. 6-week disability claim. Review ergonomic assessment.', priceUsd: '2.50', domain: 'insurance' },
  { instruction: 'Review wrongful termination claim settlement offer: $85,000 proposed. Assess adequacy vs projected litigation costs.', priceUsd: '4.50', domain: 'legal' },
  { instruction: 'Validate jewelry theft claim #TH-2024-066: Burglary during vacation. $7,800 in jewelry claimed. Check prior claims history and police report.', priceUsd: '2.00', domain: 'insurance' },
  { instruction: 'Assess construction defect claim #CD-2024-007: Foundation cracks 18 months post-build. $65,000 repair estimate. Review building inspection records.', priceUsd: '5.00', domain: 'insurance' },
  { instruction: 'Review disability claim #DI-2024-034: Long-term disability after back surgery. Claimant age 52. Assess functional capacity evaluation.', priceUsd: '3.50', domain: 'insurance' },
  { instruction: 'Validate crop insurance claim #CI-2024-011: Drought damage to corn crop. 340 acres affected. Review yield history and weather data.', priceUsd: '4.00', domain: 'insurance' },
  { instruction: 'Assess marine cargo claim #MC-2024-028: Container of electronics damaged during transit. $127,000 claimed. Review bill of lading and survey report.', priceUsd: '5.00', domain: 'insurance' },
  { instruction: 'Review dental malpractice claim #DM-2024-016: Nerve damage following extraction. Claimant seeks $35,000. Assess standard of care.', priceUsd: '4.00', domain: 'legal' },
  { instruction: 'Validate hail damage claim #HD-2024-093: 42 vehicles at car dealership. $228,000 aggregate. Review inventory and individual damage reports.', priceUsd: '5.00', domain: 'insurance' },
  { instruction: 'Review liability claim #LB-2024-055: Dog bite incident at client property. Victim requires surgery. $18,500 medical expenses. Assess homeowner coverage.', priceUsd: '3.00', domain: 'insurance' },
  { instruction: 'Assess professional liability claim #PL-2024-008: Accounting error leading to $95,000 tax penalty. Review engagement letter and work papers.', priceUsd: '5.00', domain: 'legal' },
];

const DEMO_VALIDATORS = [
  { id: 'validator::demo_senior_alice_001', tier: 'senior',   hourlyRate: 75 },
  { id: 'validator::demo_senior_bob_002',   tier: 'senior',   hourlyRate: 65 },
  { id: 'validator::demo_beginner_carol_003', tier: 'beginner', hourlyRate: 22 },
  { id: 'validator::demo_beginner_dave_004',  tier: 'beginner', hourlyRate: 20 },
  { id: 'validator::demo_beginner_eve_005',   tier: 'beginner', hourlyRate: 18 },
];

// ── Seed Functions ────────────────────────────────────────────────────────

async function seedHealth() {
  const res = await get('/api/v1/health');
  if (res.status !== 200) throw new Error(`Server not reachable at ${BASE_URL}. Start with: npm start`);
  console.log(`✓ Server healthy (${res.body.version || 'V?'})`);
}

async function seedValidators() {
  console.log(`\n── Seeding ${NUM_VALIDATORS} validators (${SCENARIO}) ──`);
  const toSeed = DEMO_VALIDATORS.slice(0, NUM_VALIDATORS);
  for (const v of toSeed) {
    const res = await post('/api/v1/validator/onboard', {
      userId:         v.id,
      email:          `${v.id.split('::')[1]}@demo.ecos.ai`,
      ip:             `192.168.1.${10 + DEMO_VALIDATORS.indexOf(v)}`,
      skillTestScore: v.tier === 'senior' ? 0.92 : 0.71,
    });
    const ok = res.status === 201 || res.status === 202;
    console.log(`  ${ok ? '✓' : '!'} ${v.id} — ${res.body?.verdict || res.status}`);
    await sleep(50);
  }
}

async function seedTasks() {
  console.log(`\n── Seeding ${NUM_TASKS} insurance claim tasks ──`);
  const tasks = INSURANCE_CLAIMS.slice(0, NUM_TASKS);
  const results = [];
  for (let i = 0; i < tasks.length; i++) {
    const t   = tasks[i];
    const res = await post('/api/v1/task', {
      instruction: t.instruction,
      priceUsd:    t.priceUsd,
      metadata:    { scenario: SCENARIO, domain: t.domain, demo: true, seededAt: new Date().toISOString() },
    });
    if (res.status === 200 || res.status === 201) {
      results.push(res.body);
      process.stdout.write(`  ✓ Task ${i + 1}/${tasks.length} (${res.body?.gateVerdict || 'queued'})\r`);
    } else {
      process.stdout.write(`  ! Task ${i + 1} failed (${res.status})\r`);
    }
    await sleep(30);
  }
  console.log(`\n  ${results.length} tasks submitted`);
  return results;
}

async function seedGoldenTasks() {
  console.log(`\n── Seeding golden task submissions ──`);
  const lib = await get('/api/v1/validator/golden-tasks/library');
  if (lib.status !== 200 || !lib.body?.tasks?.length) {
    console.log('  ! Could not load golden task library');
    return;
  }
  const tasks = lib.body.tasks.slice(0, 3);
  for (const task of tasks) {
    const v = DEMO_VALIDATORS[0];
    const res = await post('/api/v1/validator/golden-tasks/submit', {
      validatorId: v.id,
      taskId:      task.taskId,
      answer:      task.sampleAnswer || 'approve',
    });
    console.log(`  ${res.status === 200 ? '✓' : '!'} Golden task ${task.taskId} — ${res.body?.correct !== undefined ? (res.body.correct ? 'correct' : 'incorrect') : res.status}`);
    await sleep(50);
  }
}

async function seedStablecoin() {
  console.log(`\n── Seeding stablecoin deposits ──`);
  for (const v of DEMO_VALIDATORS.slice(0, 2)) {
    const amount = v.tier === 'senior' ? 50_000_000 : 20_000_000;
    const res = await post('/api/v1/rails/stablecoin/deposit', {
      accountId:  v.id,
      amountMicro: amount,
      currency:   'USDC',
      metadata:   { demo: true, scenario: SCENARIO },
    });
    console.log(`  ${res.status === 201 ? '✓' : '!'} Deposit for ${v.id} — ${res.body?.ref || res.status}`);
    await sleep(50);
  }
}

async function seedISO20022() {
  console.log(`\n── Seeding ISO 20022 wrapper events ──`);
  const payouts = [
    { beneficiaryId: DEMO_VALIDATORS[0].id, amountMicro: '37500000', referenceId: 'demo_payout_001' },
    { beneficiaryId: DEMO_VALIDATORS[1].id, amountMicro: '25000000', referenceId: 'demo_payout_002' },
  ];
  for (const p of payouts) {
    const res = await post('/api/v1/iso20022/payout-wrap', p);
    console.log(`  ${res.status === 201 ? '✓' : '!'} Payout wrap for ${p.beneficiaryId} — msgId: ${res.body?.iso20022?.msgId || res.status}`);
    await sleep(50);
  }
}

async function printSummary() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('ECOS Demo Seed Complete — V117');
  console.log('═'.repeat(60));
  console.log(`Scenario:    ${SCENARIO}`);
  console.log(`Server:      ${BASE_URL}`);
  console.log(`Validators:  ${NUM_VALIDATORS} seeded`);
  console.log(`Tasks:       ${NUM_TASKS} submitted`);
  console.log(`\nKey URLs for demo walk-through:`);
  const webBase = BASE_URL.replace(':3000', ':3001').replace('localhost', 'localhost');
  console.log(`  Dashboard:   ${webBase}/dashboard`);
  console.log(`  Validator:   ${webBase}/validator?validatorId=${DEMO_VALIDATORS[0].id}`);
  console.log(`  Val.Board:   ${webBase}/validator-dashboard?validatorId=${DEMO_VALIDATORS[0].id}`);
  console.log(`  ISO 20022:   ${webBase}/iso20022`);
  console.log(`  Beachhead:   ${webBase}/beachhead`);
  console.log(`  Onboarding:  ${webBase}/onboarding`);
  console.log(`\nAPI Health:  ${BASE_URL}/api/v1/health`);
  console.log(`DB Health:   ${BASE_URL}/api/v1/admin/db-health`);
  console.log(`ISO Events:  ${BASE_URL}/api/v1/iso20022/events`);
  console.log('═'.repeat(60));
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('ECOS Demo Seeder V117 — Insurance Claims scenario');
  console.log(`Target: ${BASE_URL}`);
  console.log('');

  try {
    await seedHealth();
    await seedValidators();
    await seedTasks();
    await seedGoldenTasks();
    await seedStablecoin();
    await seedISO20022();
    await printSummary();
    process.exit(0);
  } catch (err) {
    console.error(`\n✗ Seed failed: ${err.message}`);
    console.error('Make sure the ECOS server is running: npm start');
    process.exit(1);
  }
}

main();
