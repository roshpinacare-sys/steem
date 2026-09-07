#!/usr/bin/env node
/**
 * ECOS CLI — V96
 * ==============
 * Standalone CLI for the ECOS API server.
 * Uses only Node.js built-ins + commander (already in package.json).
 *
 * Usage:
 *   node ecos-cli.js <command> [options]
 *   BASE_URL=http://localhost:3000 node ecos-cli.js status
 *   node ecos-cli.js status --url http://localhost:3000
 *
 * Commands:
 *   status    — health + stats summary
 *   deposit   — fund a client account
 *   submit    — submit a chat task
 *   list      — list approvals
 *   approve   — approve a pending approval
 *   reject    — reject a pending approval
 *   royalties — show royalty earnings table
 *   balance   — query account balance
 *   metrics   — show Prometheus metrics table
 *   verify    — verify audit chain integrity
 *   calibrate — fit or dry-run calibrator
 *   watch     — live polling status
 *   patches   — list or search knowledge patches  [V96]
 *   mission   — show mission detail + economics   [V96]
 */

'use strict';

const http    = require('node:http');
const https   = require('node:https');
const { program } = require('commander');

// ─── ANSI colour helpers (no chalk) ─────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
  dim:    '\x1b[2m',
};
const g  = s => `${C.green}${s}${C.reset}`;
const y  = s => `${C.yellow}${s}${C.reset}`;
const r  = s => `${C.red}${s}${C.reset}`;
const b  = s => `${C.bold}${s}${C.reset}`;
const cy = s => `${C.cyan}${s}${C.reset}`;
const dm = s => `${C.dim}${s}${C.reset}`;

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function request(method, url, body, headers) {
  body    = body    || null;
  headers = headers || {};
  return new Promise(function(resolve, reject) {
    var parsed  = new URL(url);
    var isHttps = parsed.protocol === 'https:';
    var mod     = isHttps ? https : http;
    var payload = body !== null ? JSON.stringify(body) : null;

    var opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      method:   method,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      }, headers, payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    };

    var req = mod.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        var parsed_;
        try { parsed_ = JSON.parse(data); } catch (e) { parsed_ = data; }
        resolve({ status: res.statusCode, body: parsed_, text: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function requestRaw(url) {
  return new Promise(function(resolve, reject) {
    var parsed  = new URL(url);
    var isHttps = parsed.protocol === 'https:';
    var mod     = isHttps ? https : http;

    var req = mod.get({
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve({ status: res.statusCode, text: data }); });
    });
    req.on('error', reject);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtUptime(seconds) {
  if (!seconds && seconds !== 0) return 'N/A';
  var d = Math.floor(seconds / 86400);
  var h = Math.floor((seconds % 86400) / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = seconds % 60;
  var parts = [];
  if (d) parts.push(d + 'd');
  if (h) parts.push(h + 'h');
  if (m) parts.push(m + 'm');
  if (!d && !h) parts.push(s + 's');
  return parts.join(' ') || '0s';
}

function fmtRelative(isoStr) {
  if (!isoStr) return 'N/A';
  var diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60)   return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function padEnd(str, len) {
  var s = String(str != null ? str : '');
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function getBaseUrl(opts) {
  return (opts.url || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function die(msg) {
  process.stderr.write(r('✗ ' + msg) + '\n');
  process.exit(1);
}

// ─── Program Setup ───────────────────────────────────────────────────────────
program
  .name('ecos-cli')
  .description('ECOS CLI — interact with the ECOS API server')
  .version('V100')
  .option('--url <url>', 'Base URL of the ECOS API server (overrides BASE_URL env)');

// ─── STATUS ──────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show system health and stats summary')
  .action(async function() {
    var base = getBaseUrl(program.opts());
    var health, stats;
    try {
      var results = await Promise.all([
        request('GET', base + '/api/v1/health'),
        request('GET', base + '/api/v1/stats'),
      ]);
      var hr = results[0];
      var sr = results[1];
      if (hr.status !== 200) die('Health endpoint returned ' + hr.status + ': ' + JSON.stringify(hr.body));
      health = hr.body;
      stats  = sr.status === 200 ? sr.body : {};
    } catch (e) {
      die('Cannot reach server at ' + base + ': ' + e.message);
    }

    var version    = health.version || stats.version || 'N/A';
    var uptime     = fmtUptime(health.uptime || stats.uptime || 0);
    var calObj     = health.calibrator || stats.calibrator || {};
    var calReady   = calObj.ready;
    var calSamples = calObj.sampleCount || 0;
    var chainObj   = health.chain || stats.chain || {};
    var chainLen   = chainObj.length != null ? chainObj.length : 0;
    var headHash   = chainObj.headHash || 'none';
    var pending    = (stats.approvals || {}).pending != null ? (stats.approvals || {}).pending : 0;
    var db         = health.db || stats.db || 'offline';
    var platBal    = (stats.ledger || {}).platformBalance  || '0.0000';
    var insBal     = (stats.ledger || {}).insuranceBalance || '0.0000';

    var calStr = calReady
      ? g('✓ ready (' + calSamples + ' samples)')
      : y('⚠ not ready (' + calSamples + ' samples)');
    var dbStr  = db === 'connected' ? g('connected') : y('offline');
    var penStr = pending > 0 ? y(String(pending)) : g(String(pending));

    var width = 52;
    console.log('┌─ ' + b('ECOS System Status') + ' ' + '─'.repeat(width - 20) + '┐');
    console.log('│  ' + b('Version:') + ' ' + padEnd(version, 8) + ' ' + b('Uptime:') + ' ' + padEnd(uptime, 22) + '│');
    console.log('│  ' + b('Calibrator:') + ' ' + padEnd(calStr, 40) + '│');
    console.log('│  ' + b('Chain:') + ' ' + padEnd(chainLen + ' entries  ·  head: ' + headHash.slice(0, 8), 42) + '│');
    console.log('│  ' + b('Queue:') + ' ' + penStr + ' pending  ·  DB: ' + dbStr + '                  │');
    console.log('│  ' + b('Platform:') + ' $' + padEnd(platBal, 12) + b('Insurance:') + ' $' + padEnd(insBal, 10) + '│');
    console.log('└' + '─'.repeat(width + 2) + '┘');
  });

// ─── DEPOSIT ─────────────────────────────────────────────────────────────────
program
  .command('deposit <amount>')
  .description('Deposit funds into a client account')
  .option('--client <id>', 'Client account ID', 'client::cli_user')
  .action(async function(amount, opts) {
    var base      = getBaseUrl(program.opts());
    var clientId  = opts.client;
    var idemKey   = 'cli-deposit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

    var res;
    try {
      res = await request('POST', base + '/api/v1/deposit', {
        clientAccountId: clientId,
        amountUsd: String(amount),
        idempotencyKey: idemKey,
      });
    } catch (e) {
      die('Request failed: ' + e.message);
    }

    if (res.status !== 200) {
      die('Deposit failed (' + res.status + '): ' + (res.body && res.body.error ? res.body.error : res.text));
    }

    var d = res.body;
    console.log(g('✓ Deposited $' + (d.deposited || amount) + ' | Balance: $' + (d.balanceUsd || '?')));
    console.log(dm('  Account: ' + clientId + ' | depositId: ' + (d.depositId || 'N/A')));
  });

// ─── SUBMIT ──────────────────────────────────────────────────────────────────
program
  .command('submit <text>')
  .description('Submit a text task to the ECOS chat endpoint')
  .option('--price <usd>',  'Price in USD', '1.00')
  .option('--client <id>',  'Client account ID', 'client::cli_user')
  .action(async function(text, opts) {
    var base = getBaseUrl(program.opts());

    var res;
    try {
      res = await request('POST', base + '/api/v1/chat', {
        message: text,
        clientAccountId: opts.client,
        priceUsd: String(opts.price),
      });
    } catch (e) {
      die('Request failed: ' + e.message);
    }

    if (res.status !== 200) {
      die('Submit failed (' + res.status + '): ' + (res.body && res.body.error ? res.body.error : res.text));
    }

    var d       = res.body;
    var verdict = d.verdict || d.status || 'UNKNOWN';

    if (verdict === 'HITL_QUEUE') {
      console.log(y('Verdict: HITL_QUEUE') + ' | approvalId: ' + cy(d.approvalId || d.id || 'N/A'));
    } else if (verdict === 'AUTO_FLOW' || verdict === 'settled') {
      console.log(g('Verdict: AUTO_FLOW') + '  | settled');
      if (d.split) {
        console.log(dm('  Platform: $' + d.split.platform + '  Validator: $' + d.split.validator + '  Insurance: $' + d.split.insurance));
      }
    } else {
      console.log('Verdict: ' + verdict);
      if (d.approvalId) console.log('  approvalId: ' + cy(d.approvalId));
    }
    if (d.aiOutput && d.aiOutput.result) {
      var preview = String(d.aiOutput.result).slice(0, 120);
      console.log(dm('  Result: ' + preview + (String(d.aiOutput.result).length > 120 ? '…' : '')));
    }
  });

// ─── LIST ─────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List approvals')
  .option('--status <s>',  'Filter: pending|all', 'pending')
  .option('--limit <n>',   'Max rows to show', '20')
  .option('--cursor <id>', 'Cursor ID for next page pagination')
  .action(async function(opts) {
    var base  = getBaseUrl(program.opts());
    var limit = parseInt(opts.limit, 10) || 20;

    var url = base + '/api/v1/approvals?status=' + opts.status + '&limit=' + limit;
    if (opts.cursor) url += '&cursor=' + encodeURIComponent(opts.cursor);

    var res;
    try {
      res = await request('GET', url);
    } catch (e) {
      die('Request failed: ' + e.message);
    }

    if (res.status !== 200) {
      die('List failed (' + res.status + '): ' + (res.body && res.body.error ? res.body.error : res.text));
    }

    var approvals = (res.body && res.body.approvals) || [];

    if (approvals.length === 0) {
      console.log(dm('No approvals found (status=' + opts.status + ')'));
      return;
    }

    console.log(
      b(padEnd('ID', 20)) + '  ' +
      b(padEnd('STATUS', 10)) + '  ' +
      b(padEnd('PRICE', 7)) + '  ' +
      b(padEnd('CONFIDENCE', 12)) + '  ' +
      b('CREATED')
    );
    console.log('─'.repeat(70));

    for (var i = 0; i < approvals.length; i++) {
      var ap      = approvals[i];
      var idStr   = padEnd(ap.id || '?', 20);
      var statStr = padEnd(ap.status || '?', 10);
      var priceStr = padEnd(ap.priceUsd ? '$' + ap.priceUsd : 'N/A', 7);
      var confStr  = padEnd(ap.confidence != null ? String(ap.confidence) : 'null', 12);
      var creStr   = fmtRelative(ap.createdAt);

      var colStatus = ap.status === 'pending'
        ? y(statStr)
        : ap.status === 'approved' ? g(statStr) : r(statStr);

      console.log(idStr + '  ' + colStatus + '  ' + priceStr + '  ' + dm(confStr) + '  ' + dm(creStr));
    }
    console.log(dm('\nShowing ' + approvals.length + ' of ' + ((res.body && res.body.count) || approvals.length) + ' approvals'));

    // [V97] Cursor pagination hint
    if (res.body && res.body.hasMore && res.body.cursor) {
      console.log(dm('More results available.'));
      console.log(dm('Run with --cursor ' + res.body.cursor + ' to see next page'));
    }
  });

// ─── APPROVE ─────────────────────────────────────────────────────────────────
program
  .command('approve <approvalId>')
  .description('Approve a pending approval')
  .option('--validator <id>', 'Validator account ID', 'validator::cli_user')
  .option('--note <text>',    'Optional note')
  .action(async function(approvalId, opts) {
    var base = getBaseUrl(program.opts());

    var body = {
      validatorAccountId: opts.validator,
      decision: 'approve',
    };
    if (opts.note) body.note = opts.note;

    var res;
    try {
      res = await request('POST', base + '/api/v1/approvals/' + approvalId + '/resolve', body);
    } catch (e) {
      die('Request failed: ' + e.message);
    }

    if (res.status !== 200) {
      die('Approve failed (' + res.status + '): ' + (res.body && res.body.error ? res.body.error : res.text));
    }

    var d      = res.body;
    var earned = (d.split && d.split.validator) ? '$' + d.split.validator : 'N/A';
    console.log(g('✓ Approved ' + approvalId) + ' | Validator earned: ' + cy(earned));
    if (d.validatorBalance) {
      console.log(dm('  New balance: $' + d.validatorBalance + ' for ' + opts.validator));
    }
  });

// ─── REJECT ──────────────────────────────────────────────────────────────────
program
  .command('reject <approvalId>')
  .description('Reject a pending approval')
  .option('--validator <id>', 'Validator account ID', 'validator::cli_user')
  .option('--note <text>',    'Optional note')
  .action(async function(approvalId, opts) {
    var base = getBaseUrl(program.opts());

    var body = {
      validatorAccountId: opts.validator,
      decision: 'reject',
    };
    if (opts.note) body.note = opts.note;

    var res;
    try {
      res = await request('POST', base + '/api/v1/approvals/' + approvalId + '/resolve', body);
    } catch (e) {
      die('Request failed: ' + e.message);
    }

    if (res.status !== 200) {
      die('Reject failed (' + res.status + '): ' + (res.body && res.body.error ? res.body.error : res.text));
    }

    var d = res.body;
    console.log(r('✗ Rejected ' + approvalId) + ' | status: ' + (d.status || 'rejected'));
  });

// ─── ROYALTIES ───────────────────────────────────────────────────────────────
program
  .command('royalties')
  .description('Show royalty earnings table')
  .option('--validator <id>', 'Validator ID', 'validator::cli_user')
  .option('--limit <n>', 'Max rows to show', '20')
  .action(async function(opts) {
    var base        = getBaseUrl(program.opts());
    var validatorId = opts.validator;
    var limit       = parseInt(opts.limit, 10) || 20;

    // Fetch earnings for the specified validator
    var earningsRes;
    try {
      earningsRes = await request('GET', base + '/api/v1/validator/' + encodeURIComponent(validatorId) + '/earnings');
    } catch (e) {
      die('Request failed: ' + e.message);
    }

    if (earningsRes.status !== 200) {
      // Fall back to full state for royalty-related balances
      var stateRes;
      try {
        stateRes = await request('GET', base + '/api/v1/state');
      } catch (e) {
        die('Request failed: ' + e.message);
      }
      if (stateRes.status !== 200) {
        die('Royalties fetch failed (' + earningsRes.status + '): ' +
          (earningsRes.body && earningsRes.body.error ? earningsRes.body.error : earningsRes.text));
      }
      var accounts = (stateRes.body && stateRes.body.accounts) || [];
      var rows = accounts
        .filter(function(a) { return a.id && a.id.startsWith('validator::'); })
        .slice(0, limit);

      console.log('');
      console.log(b(padEnd('VALIDATOR', 30) + '  ' + padEnd('BALANCE_USD', 14) + '  KIND'));
      console.log(dm('─'.repeat(60)));
      if (rows.length === 0) {
        console.log(dm('  (no validator accounts found)'));
      } else {
        rows.forEach(function(a) {
          console.log(
            cy(padEnd(a.id, 30)) + '  ' +
            g(padEnd('$' + (a.balance_usd || '0.0000'), 14)) + '  ' +
            dm(a.kind || 'validator')
          );
        });
      }
      console.log('');
      return;
    }

    // Render single-validator earnings table
    var d = earningsRes.body;
    console.log('');
    console.log(b(padEnd('VALIDATOR', 30) + '  ' + padEnd('EARNED_USD', 14) + '  PATCHES'));
    console.log(dm('─'.repeat(60)));
    console.log(
      cy(padEnd(validatorId, 30)) + '  ' +
      g(padEnd('$' + (d.totalEarned || '0.0000'), 14)) + '  ' +
      dm(String(d.resolvedCount != null ? d.resolvedCount : 'N/A'))
    );
    console.log('');
    if (d.taskEarnings)   console.log(dm('  Task earnings:   $' + d.taskEarnings));
    if (d.royaltyEarnings) console.log(dm('  Royalty earnings: $' + d.royaltyEarnings));
    console.log('');
  });

// ─── BALANCE ─────────────────────────────────────────────────────────────────
program
  .command('balance')
  .description('Query account balance')
  .option('--account <id>', 'Account ID', 'client::cli_user')
  .action(async function(opts) {
    var base      = getBaseUrl(program.opts());
    var accountId = opts.account;

    var res;
    try {
      res = await request('GET', base + '/api/v1/account?id=' + encodeURIComponent(accountId));
    } catch (e) {
      die('Request failed: ' + e.message);
    }

    if (res.status !== 200) {
      die('Balance failed (' + res.status + '): ' + (res.body && res.body.error ? res.body.error : res.text));
    }

    var d = res.body;
    console.log('Account: ' + cy(d.id || accountId) + ' | Balance: ' + g('$' + (d.balance_usd || '0.0000')));
    console.log(dm('  Kind: ' + (d.kind || 'N/A') + '  |  Microcents: ' + (d.balance_micro || '0')));
  });

// ─── METRICS ─────────────────────────────────────────────────────────────────
program
  .command('metrics')
  .description('Show Prometheus metrics gauges')
  .action(async function() {
    var base = getBaseUrl(program.opts());

    var res;
    try {
      res = await requestRaw(base + '/api/v1/metrics');
    } catch (e) {
      die('Request failed: ' + e.message);
    }

    if (res.status !== 200) {
      die('Metrics endpoint returned ' + res.status);
    }

    var lines = res.text.split('\n').filter(function(l) {
      return /^ecos_\w+ [\d.]+/.test(l);
    });

    if (lines.length === 0) {
      die('No metrics data returned from server');
    }

    var maxLen = 8;
    for (var i = 0; i < lines.length; i++) {
      var name = lines[i].split(' ')[0];
      if (name.length > maxLen) maxLen = name.length;
    }
    var metricWidth = maxLen + 2;

    console.log(b(padEnd('METRIC', metricWidth)) + '  ' + b('VALUE'));
    console.log('─'.repeat(metricWidth + 20));
    for (var j = 0; j < lines.length; j++) {
      var parts = lines[j].trim().split(/\s+/);
      console.log(cy(padEnd(parts[0], metricWidth)) + '  ' + g(parts[1]));
    }
    console.log(dm('\n' + lines.length + ' gauges from ' + base + '/api/v1/metrics'));
  });

// ─── VERIFY ──────────────────────────────────────────────────────────────────
program
  .command('verify')
  .description('Verify audit chain integrity')
  .action(async function() {
    var base = getBaseUrl(program.opts());

    var res;
    try {
      res = await request('GET', base + '/api/v1/verify');
    } catch (e) {
      die('Request failed: ' + e.message);
    }

    if (res.status !== 200) {
      die('Verify failed (' + res.status + '): ' + (res.body && res.body.error ? res.body.error : res.text));
    }

    var d = res.body;
    if (d.ok) {
      console.log(g('✓ Chain intact (' + (d.length || 0) + ' entries)'));
      if (d.head && d.head !== '0000000000000000000000000000000000000000000000000000000000000000') {
        console.log(dm('  Head: ' + d.head.slice(0, 16) + '…'));
      }
    } else {
      var reason = d.reason || 'unknown';
      console.log(r('✗ Chain BROKEN') + ' — reason: ' + reason);
      if (d.brokenAt !== undefined) console.log(r('  Broken at entry: ' + d.brokenAt));
      process.exit(1);
    }
  });

// ─── CALIBRATE ───────────────────────────────────────────────────────────────
program
  .command('calibrate')
  .description('Fit the calibrator with synthetic data (or dry-run locally)')
  .option('--dry-run', 'Compute params locally without posting to server')
  .action(async function(opts) {
    var base = getBaseUrl(program.opts());

    function linSpace(start, end, count) {
      var vals = [];
      var step = count > 1 ? (end - start) / (count - 1) : 0;
      for (var i = 0; i < count; i++) {
        vals.push(parseFloat((start + step * i).toFixed(6)));
      }
      return vals;
    }

    var samples = [];
    linSpace(0.70, 0.98, 25).forEach(function(v) { samples.push({ rawScore: v, label: 1 }); });
    linSpace(0.52, 0.69, 15).forEach(function(v) { samples.push({ rawScore: v, label: 1 }); });
    linSpace(0.30, 0.51, 12).forEach(function(v) { samples.push({ rawScore: v, label: 0 }); });
    linSpace(0.65, 0.80,  8).forEach(function(v) { samples.push({ rawScore: v, label: 0 }); });

    var sigmoid = function(x) { return 1 / (1 + Math.exp(-x)); };
    var A = 0;
    var B = 0;
    var lr = 0.1;
    var epochs = 2000;
    for (var e = 0; e < epochs; e++) {
      var dA = 0;
      var dB = 0;
      for (var i = 0; i < samples.length; i++) {
        var x   = samples[i].rawScore;
        var y_  = samples[i].label;
        var p   = sigmoid(A * x + B);
        var err = p - y_;
        dA += err * x;
        dB += err;
      }
      A -= (lr / samples.length) * dA;
      B -= (lr / samples.length) * dB;
    }

    var params = {
      A: parseFloat(A.toFixed(10)),
      B: parseFloat(B.toFixed(10)),
      sampleCount: samples.length,
      fittedAt: new Date().toISOString(),
    };

    if (opts.dryRun) {
      console.log(b('── Calibration Dry Run ──────────────────'));
      console.log('  A           = ' + cy(String(params.A)));
      console.log('  B           = ' + cy(String(params.B)));
      console.log('  sampleCount = ' + g(String(params.sampleCount)));
      console.log('  fittedAt    = ' + dm(params.fittedAt));
      var check = sigmoid(A * 0.85 + B);
      console.log('  Check: rawScore=0.85 → calibrated=' + g(check.toFixed(6)));
      console.log(y('  No POST sent (--dry-run mode)'));
      return;
    }

    console.log(dm('Sending ' + samples.length + ' synthetic samples to ' + base + '/api/v1/calibrator/fit …'));

    var res;
    try {
      res = await request('POST', base + '/api/v1/calibrator/fit', { data: samples });
    } catch (e) {
      die('Request failed: ' + e.message);
    }

    if (res.status !== 200) {
      die('Calibrate failed (' + res.status + '): ' + (res.body && res.body.error ? res.body.error : res.text));
    }

    var d = res.body;
    console.log(g('✓ Calibration complete'));
    console.log('  A           = ' + cy(String(d.A != null ? d.A : params.A)));
    console.log('  B           = ' + cy(String(d.B != null ? d.B : params.B)));
    console.log('  sampleCount = ' + g(String(d.sampleCount != null ? d.sampleCount : params.sampleCount)));
    console.log('  ready       = ' + (d.ready ? g('true') : y('false')));
    console.log('  persisted   = ' + dm(String(d.persisted || 'N/A')));
  });

// ─── WATCH ───────────────────────────────────────────────────────────────────
program
  .command('watch')
  .description('Live terminal polling of system stats (TUI dashboard)')
  .option('--interval <n>', 'Poll interval in seconds', '5')
  .action(async function(opts) {
    var base     = getBaseUrl(program.opts());
    var interval = parseInt(opts.interval, 10) || 5;

    var running = true;
    process.on('SIGINT', function() {
      running = false;
      process.stdout.write('\x1b[2J\x1b[H');
      console.log(dm('Watch stopped.'));
      process.exit(0);
    });

    function pad(str, len) {
      var s = String(str);
      while (s.length < len) s += ' ';
      return s;
    }

    function fmtEvent(ev) {
      if (!ev) return '';
      var type   = ev.type || 'unknown';
      var mid    = (ev.missionId || ev.id || '').slice(0, 8);
      var ago    = '';
      if (ev.ts) {
        var diff = Math.floor((Date.now() - new Date(ev.ts).getTime()) / 1000);
        ago = diff + 's ago';
      }
      var amtPart = '';
      if (ev.payload && ev.payload.split && ev.payload.split.gross) {
        amtPart = '  ' + ev.payload.split.gross;
      }
      // Color code by type
      var typeStr;
      if      (type === 'task.created')      typeStr = cy(pad(type, 20));
      else if (type === 'auto.settled')       typeStr = g(pad(type, 20));
      else if (type === 'approval.resolved')  typeStr = g(pad(type, 20));
      else if (type === 'approval.created')   typeStr = y(pad(type, 20));
      else if (type === 'gate.evaluated')     typeStr = y(pad(type, 20));
      else                                    typeStr = dm(pad(type, 20));
      return '  ● ' + typeStr + '  ' + dm(pad(mid, 12)) + amtPart + '  ' + dm(ago);
    }

    var BOX_W = 58;
    function line(content) {
      return '│ ' + pad(content, BOX_W - 2) + ' │';
    }
    function divider() {
      return '├' + '─'.repeat(BOX_W) + '┤';
    }
    function top(title) {
      return '┌─ ' + title + ' ' + '─'.repeat(Math.max(0, BOX_W - title.length - 3)) + '┐';
    }
    function bottom() {
      return '└' + '─'.repeat(BOX_W) + '┘';
    }

    async function poll() {
      try {
        var results = await Promise.all([
          request('GET', base + '/api/v1/stats'),
          request('GET', base + '/api/v1/events/recent?limit=3'),
        ]);

        var sr = results[0].status === 200 ? results[0].body : {};
        var er = results[1].status === 200 ? results[1].body : {};

        var ts       = new Date().toLocaleTimeString();
        var up       = fmtUptime((sr.uptime) || 0);
        var ver      = sr.version || 'V98';
        var calObj   = sr.calibrator || {};
        var calStr   = calObj.ready
          ? g('✓ ready') + dm(' (' + (calObj.sampleCount || 0) + ' samples)')
          : y('not ready');
        var chainObj = sr.chain || {};
        var chainLen = chainObj.length != null ? String(chainObj.length) : '?';
        var headHash = chainObj.headHash ? chainObj.headHash.slice(0, 8) : '?';
        var appObj   = sr.approvals || {};
        var pending  = appObj.pending != null ? String(appObj.pending) : '?';
        var totalApp = appObj.total   != null ? String(appObj.total)   : '?';
        var platBal  = (sr.platform || {}).balanceUsd != null ? '$' + sr.platform.balanceUsd : '?';
        var insBal   = (sr.insurance || {}).balanceUsd != null ? '$' + sr.insurance.balanceUsd : '?';
        var wsClients = sr.wsClients != null ? String(sr.wsClients) : '?';

        var recentEvts = Array.isArray(er.events) ? er.events.slice(0, 3) : [];

        // Build box
        var titleStr = b('ECOS Watch') + ' ─── [' + dm(ts) + '] [' + g('●polling') + ']';
        var lines = [
          top('ECOS Watch ─────────────────── [' + ts + '] [●polling]'),
          line(b('Version: ') + ver + '   Uptime: ' + cy(up)),
          line(b('Calibrator: ') + calStr),
          line(b('Chain: ') + cy(chainLen) + ' entries · Head: ' + dm(headHash)),
          divider(),
          line(b('Queue: ') + (parseInt(pending) > 0 ? y(pending) : g(pending)) + ' pending · ' + totalApp + ' total'),
          line(b('Platform: ') + platBal + ' · Insurance: ' + insBal),
          line(b('WS Clients: ') + wsClients + ' connected'),
          divider(),
          line(b('Recent events (last 3):')),
        ];
        if (recentEvts.length === 0) {
          lines.push(line(dm('  (no events yet)')));
        } else {
          for (var i = 0; i < recentEvts.length; i++) {
            lines.push(line(fmtEvent(recentEvts[i])));
          }
        }
        lines.push(bottom());
        lines.push(dm('Press Ctrl+C to exit'));

        // Clear screen and rewrite
        process.stdout.write('\x1b[2J\x1b[H');
        process.stdout.write(lines.join('\n') + '\n');

      } catch (e) {
        process.stdout.write('\x1b[2J\x1b[H');
        var errLines = [
          top('ECOS Watch'),
          line(r('[SERVER UNREACHABLE]') + '  ' + dm(new Date().toLocaleTimeString())),
          line(dm('Retrying in ' + interval + 's...')),
          bottom(),
          dm('Press Ctrl+C to exit'),
        ];
        process.stdout.write(errLines.join('\n') + '\n');
      }
    }

    await poll();
    var timer = setInterval(async function() {
      if (!running) { clearInterval(timer); return; }
      await poll();
    }, interval * 1000);
  });

// ─── STREAM ──────────────────────────────────────────────────────────────────
// [V90-P5] Subscribe to the monitor's live metric stream via SSE.
program
  .command('stream')
  .description('Subscribe to the monitor\'s live metric stream (SSE). Press Ctrl+C to exit.')
  .option('--monitor-url <url>', 'Monitor base URL (default: http://localhost:3099)')
  .action(function(opts) {
    var monitorBase = (opts.monitorUrl || process.env.MONITOR_URL || 'http://localhost:3099').replace(/\/$/, '');
    var streamUrl   = monitorBase + '/monitor/stream';

    console.log(b('ECOS Stream') + ' — subscribing to ' + cy(streamUrl) + '  ' + dm('(Ctrl+C to exit)'));
    console.log('');

    var parsed  = new URL(streamUrl);
    var isHttps = parsed.protocol === 'https:';
    var mod     = isHttps ? https : http;

    var req = mod.get({
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      headers:  { Accept: 'text/event-stream' },
    }, function(res) {
      if (res.statusCode !== 200) {
        die('Monitor stream returned HTTP ' + res.statusCode + ' — is the monitor running?');
      }

      // SSE line buffer — accumulate lines, dispatch on blank line
      var buf = '';
      res.on('data', function(chunk) {
        buf += chunk.toString();
        // Split on double-newline (SSE event boundary)
        var events = buf.split('\n\n');
        buf = events.pop(); // keep incomplete tail

        events.forEach(function(block) {
          var lines = block.split('\n');
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            // Silently ignore `: heartbeat` comment events
            if (line.startsWith(':')) continue;
            if (line.startsWith('data: ')) {
              var payload = line.slice(6).trim();
              if (!payload) continue;
              try {
                var reading = JSON.parse(payload);
                var ts      = new Date(reading.ts || Date.now());
                var hh      = String(ts.getHours()).padStart(2, '0');
                var mm      = String(ts.getMinutes()).padStart(2, '0');
                var ss      = String(ts.getSeconds()).padStart(2, '0');
                var g_      = reading.gauges || {};
                var uptime  = g_.ecos_uptime_seconds != null ? Math.round(g_.ecos_uptime_seconds) + 's' : '?';
                var chain   = g_.ecos_chain_length   != null ? String(Math.round(g_.ecos_chain_length))  : '?';
                var pending = g_.ecos_pending_approvals != null ? String(Math.round(g_.ecos_pending_approvals)) : '?';
                var calRaw  = g_.ecos_calibrator_ready;
                var cal     = calRaw == null ? '?' : (calRaw === 1 ? g('ready') : y('not-ready'));

                console.log(
                  dm('[' + hh + ':' + mm + ':' + ss + ']') + ' ' +
                  'uptime=' + cy(uptime) + ' | ' +
                  'chain=' + cy(chain) + ' | ' +
                  'pending=' + (g_.ecos_pending_approvals > 0 ? y(pending) : g(pending)) + ' | ' +
                  'calibrator=' + cal
                );
              } catch (e) {
                // Unparseable data event — skip
              }
            }
          }
        });
      });

      res.on('error', function(e) {
        die('Stream error: ' + e.message);
      });

      res.on('end', function() {
        console.log(dm('\n[stream closed by server]'));
        process.exit(0);
      });
    });

    req.on('error', function(e) {
      die('Cannot connect to monitor at ' + monitorBase + ': ' + e.message);
    });

    // Graceful Ctrl+C: close connection, exit 0
    process.on('SIGINT', function() {
      process.stdout.write('\n');
      console.log(dm('Stream stopped.'));
      req.destroy();
      process.exit(0);
    });
  });

// ─── PATCHES ─────────────────────────────────────────────────────────────────
// [V96-P4] List or search knowledge patches via GET /api/v1/patches
program
  .command('patches')
  .description('List knowledge patches (leaderboard). Use --query to search by keyword.')
  .option('--url <url>', 'Express API base URL')
  .option('-q, --query <text>', 'Search patches by keyword (TF-IDF)')
  .option('-n, --limit <n>', 'Max results to show (default: 10)', '10')
  .option('--sort <field>', 'Sort order: royalties | recent | quality (default: royalties)', 'royalties')
  .action(function(opts) {
    var base = (opts.url || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    var qs   = '?sort=' + encodeURIComponent(opts.sort) + '&limit=' + encodeURIComponent(opts.limit);
    if (opts.query) qs += '&q=' + encodeURIComponent(opts.query);
    var url  = base + '/api/v1/patches' + qs;

    request('GET', url, null, {}).then(function(resp) {
      if (resp.status !== 200) {
        console.error(r('Error ' + resp.status + ': ' + JSON.stringify(resp.body)));
        process.exit(1);
      }
      var patches = resp.body.patches || [];
      var note    = resp.body.note;
      var count   = resp.body.count != null ? resp.body.count : patches.length;

      if (note) {
        console.log(y('Note: ') + note);
      }
      if (opts.query) {
        console.log(b('ECOS Patches') + ' — search: ' + cy(opts.query) + '  (sort: ' + opts.sort + ')');
      } else {
        console.log(b('ECOS Patches') + ' — top ' + opts.limit + '  (sort: ' + opts.sort + ')');
      }
      console.log('');

      if (patches.length === 0) {
        console.log(dm('No patches found.'));
        return;
      }

      // Header
      console.log(
        dm(padEnd('ID',          26) + '  ' +
           padEnd('Reuse',        6) + '  ' +
           padEnd('Score',        7) + '  ' +
           padEnd('EarnedUSD',   12) + '  ' +
           'Preview')
      );
      console.log(dm('─'.repeat(90)));

      for (var i = 0; i < patches.length; i++) {
        var p = patches[i];
        var score    = p.score     != null ? String(p.score.toFixed ? p.score.toFixed(4) : p.score) : '—';
        var reuse    = p.reuseCount != null ? String(p.reuseCount) : (p.reuse_count != null ? String(p.reuse_count) : '—');
        var earned   = p.earnedUsd  || '—';
        var preview  = String(p.preview || '').slice(0, 50).replace(/\n/g, ' ');
        var id       = p.patchId   || p.id || '—';

        console.log(
          cy(padEnd(id,      26)) + '  ' +
          padEnd(reuse,       6) + '  ' +
          g(padEnd(score,     7)) + '  ' +
          g(padEnd(earned,   12)) + '  ' +
          dm(preview)
        );
      }

      console.log('');
      console.log(dm('Total: ' + count + ' patch(es)'));
    }).catch(function(err) {
      die('patches fetch failed: ' + err.message);
    });
  });

// ─── MISSION ─────────────────────────────────────────────────────────────────
// [V96-P4] View mission detail summary via GET /api/v1/mission/:id
program
  .command('mission <id>')
  .description('Show detail, economics, and audit trail for a mission.')
  .option('--url <url>', 'Express API base URL')
  .action(function(missionId, opts) {
    var base = (opts.url || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    var url  = base + '/api/v1/mission/' + encodeURIComponent(missionId);

    request('GET', url, null, {}).then(function(resp) {
      if (resp.status !== 200) {
        console.error(r('Error ' + resp.status + ': ' + JSON.stringify(resp.body)));
        process.exit(1);
      }
      var d         = resp.body;
      var summary   = d.summary     || {};
      var approvals = d.approvals   || [];
      var ledger    = d.ledgerEntries || [];
      var audit     = d.auditTrail  || [];
      var patches   = Array.isArray(d.patches) ? d.patches : [];

      console.log(b('Mission') + ' ' + cy(missionId));
      console.log(dm('─'.repeat(70)));
      console.log('  Flow:        ' + (summary.flow      || '—'));
      console.log('  Decision:    ' + (summary.decision  || '—'));
      console.log('  Total billed: $' + (summary.totalBilledUsd || '0.00'));
      console.log('  Approvals:   ' + (summary.resolved || 0) + '/' + (summary.totalApprovals || approvals.length) + ' resolved');
      if (patches.length > 0) {
        console.log('  Patches:     ' + g(String(patches.length) + ' applied'));
      }
      console.log('');

      if (approvals.length > 0) {
        console.log(b('Approvals'));
        for (var i = 0; i < approvals.length; i++) {
          var a = approvals[i];
          console.log('  ' + cy(a.id || '—') + '  status=' + (a.status || '—') + '  confidence=' + (a.confidence != null ? (a.confidence * 100).toFixed(1) + '%' : '—'));
        }
        console.log('');
      }

      if (ledger.length > 0) {
        console.log(b('Ledger entries') + ' (' + ledger.length + ')');
        for (var j = 0; j < ledger.length; j++) {
          var e = ledger[j];
          console.log('  ' + dm(e.id || '—') + '  $' + (e.amountUsd || '0') + '  ' + (e.meta && e.meta.leg ? e.meta.leg : e.kind || '—'));
        }
        console.log('');
      }

      console.log(b('Audit trail') + ' ' + dm('(' + audit.length + ' entries)'));
    }).catch(function(err) {
      die('mission fetch failed: ' + err.message);
    });
  });

// ─── [V99] search — Mission full-text search ─────────────────────────────────
program
  .command('search <query>')
  .description('Full-text search across missions. Optionally filter by status, clientId, date range, and minPrice.')
  .option('--url <url>',      'API base URL')
  .option('--status <s>',     'Filter: pending|approved|rejected|all (default: all)')
  .option('--client <id>',    'Filter by clientAccountId')
  .option('--from <iso>',     'Created after this ISO timestamp')
  .option('--to <iso>',       'Created before this ISO timestamp')
  .option('--min-price <n>',  'Minimum priceUsd')
  .option('--limit <n>',      'Max results (default: 10)')
  .action(function(query, opts) {
    var base   = (opts.url || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    var params = new URLSearchParams();
    params.set('q', query);
    if (opts.status)   params.set('status',    opts.status);
    if (opts.client)   params.set('clientId',  opts.client);
    if (opts.from)     params.set('from',       opts.from);
    if (opts.to)       params.set('to',         opts.to);
    if (opts.minPrice) params.set('minPrice',   opts.minPrice);
    if (opts.limit)    params.set('limit',      opts.limit);

    request('GET', base + '/api/v1/missions/search?' + params.toString(), null, {}).then(function(resp) {
      if (resp.status !== 200) {
        console.error(r('Error ' + resp.status + ': ' + JSON.stringify(resp.body)));
        process.exit(1);
      }
      var data     = resp.body;
      var missions = data.missions || [];
      console.log(b('Mission Search') + ' query=' + cy(query) + '  total=' + g(String(data.count || 0)));
      console.log(dm('─'.repeat(70)));
      if (missions.length === 0) {
        console.log('  ' + dm('No results found.'));
        return;
      }
      missions.forEach(function(m, i) {
        console.log('  ' + (i + 1) + '. ' + cy(m.missionId || m.approvalId)
          + '  status=' + (m.status || '—')
          + '  score=' + (m.score != null ? m.score.toFixed(4) : '—')
          + '  $' + (m.priceUsd || '?')
        );
      });
      if (data.hasMore) {
        console.log('  ' + dm('… more results, use --limit or paginate with cursor=' + data.cursor));
      }
    }).catch(function(err) { die('search failed: ' + err.message); });
  });

// ─── [V99] batch — Batch task submission ─────────────────────────────────────
program
  .command('batch <tasks...>')
  .description('Submit multiple tasks in a single batch request. Each task is: "clientId:price:message".')
  .option('--url <url>',   'API base URL')
  .option('--idem <key>',  'Idempotency key for dedup')
  .action(function(rawTasks, opts) {
    var base = (opts.url || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    var tasks = rawTasks.map(function(t) {
      var parts = t.split(':');
      if (parts.length < 3) {
        console.error(r('Invalid task format (need clientId:price:message): ' + t));
        process.exit(1);
      }
      return {
        clientAccountId: parts[0],
        priceUsd:        parts[1],
        message:         parts.slice(2).join(':'),
      };
    });

    var payload = { tasks: tasks };
    if (opts.idem) payload.idempotencyKey = opts.idem;

    request('POST', base + '/api/v1/batch', payload, {}).then(function(resp) {
      if (resp.status !== 200) {
        console.error(r('Error ' + resp.status + ': ' + JSON.stringify(resp.body)));
        process.exit(1);
      }
      var data    = resp.body;
      var summary = data.summary || {};
      console.log(b('Batch') + ' ' + cy(data.batchId));
      console.log('  Processed: ' + (data.processed || 0)
        + '  AutoFlow: ' + g(String(summary.autoFlow || 0))
        + '  HitlQueue: ' + (summary.hitlQueue || 0)
        + '  Errors: ' + (summary.errors ? r(String(summary.errors)) : '0')
      );
      (data.results || []).forEach(function(r2, i) {
        console.log('  [' + r2.index + '] ' + (r2.verdict === 'AUTO_FLOW' ? g(r2.verdict) : cy(r2.verdict))
          + '  approvalId=' + (r2.approvalId || '—'));
      });
      (data.errors || []).forEach(function(e) {
        console.log('  [' + e.index + '] ' + r('ERROR') + ' ' + e.error);
      });
    }).catch(function(err) { die('batch failed: ' + err.message); });
  });

// ─── [V99] audit-report — Export & Audit Report ──────────────────────────────
program
  .command('audit-report')
  .description('Export a full audit report (JSON or CSV) of all mission approvals.')
  .option('--url <url>',      'API base URL')
  .option('--format <fmt>',   'Output format: json|csv (default: json)')
  .option('--from <iso>',     'Filter from ISO timestamp')
  .option('--to <iso>',       'Filter to ISO timestamp')
  .option('--status <s>',     'Filter: pending|approved|rejected|all')
  .option('--out <file>',     'Write output to file (stdout if omitted)')
  .action(function(opts) {
    var fs   = require('fs');
    var base = (opts.url || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    var params = new URLSearchParams();
    if (opts.format) params.set('format', opts.format);
    if (opts.from)   params.set('from',   opts.from);
    if (opts.to)     params.set('to',     opts.to);
    if (opts.status) params.set('status', opts.status);

    request('GET', base + '/api/v1/export/audit-report?' + params.toString(), null, {}).then(function(resp) {
      if (resp.status !== 200) {
        console.error(r('Error ' + resp.status + ': ' + JSON.stringify(resp.body)));
        process.exit(1);
      }

      if ((opts.format || 'json') === 'csv') {
        var text = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body, null, 2);
        if (opts.out) {
          fs.writeFileSync(opts.out, text);
          console.log(g('✔ Written to ' + opts.out));
        } else {
          process.stdout.write(text + '\n');
        }
        return;
      }

      // JSON
      var data    = resp.body;
      var summary = data.summary || {};
      console.log(b('Audit Report') + '  generated=' + cy(data.generatedAt || '—'));
      console.log(dm('─'.repeat(70)));
      console.log('  Version:          ' + (data.version || '—'));
      console.log('  Total missions:   ' + (summary.totalMissions   || 0));
      console.log('  Approved:         ' + g(String(summary.totalApproved  || 0)));
      console.log('  Rejected:         ' + r(String(summary.totalRejected  || 0)));
      console.log('  Pending:          ' + (summary.totalPending    || 0));
      console.log('  Total revenue:    ' + (summary.totalRevenue    || '$0.00'));
      console.log('  Validator payouts:' + (summary.validatorPayouts || '$0.00'));
      console.log('  Chain length:     ' + (summary.chainLength     || 0));
      console.log('  Chain integrity:  ' + (summary.chainIntegrity ? g('OK') : r('FAIL')));

      if (opts.out) {
        fs.writeFileSync(opts.out, JSON.stringify(data, null, 2));
        console.log(g('\n✔ Written to ' + opts.out));
      }
    }).catch(function(err) { die('audit-report failed: ' + err.message); });
  });

// ─── [V99] reputation — Validator reputation score ───────────────────────────
program
  .command('reputation <validatorId>')
  .description('Show reputation score and stats for a validator.')
  .option('--url <url>', 'API base URL')
  .action(function(validatorId, opts) {
    var base = (opts.url || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    request('GET', base + '/api/v1/validator/' + encodeURIComponent(validatorId) + '/reputation', null, {}).then(function(resp) {
      if (resp.status !== 200) {
        console.error(r('Error ' + resp.status + ': ' + JSON.stringify(resp.body)));
        process.exit(1);
      }
      var d = resp.body;
      console.log(b('Validator Reputation') + ' ' + cy(d.validatorId || validatorId));
      console.log(dm('─'.repeat(60)));
      console.log('  Score:        ' + g(String(d.score || 0)) + ' / 100');
      console.log('  Rank:         #' + (d.rank || 0));
      console.log('  Total tasks:  ' + (d.totalTasks || 0));
      console.log('  Approved:     ' + g(String(d.approved || 0)));
      console.log('  Rejected:     ' + r(String(d.rejected || 0)));
      console.log('  Approval rate:' + (d.approvalRate || 0) + '%');
      console.log('  Earnings:     $' + (d.totalEarned || 0));
      console.log('  Last active:  ' + (d.lastActiveAt || '—'));
    }).catch(function(err) { die('reputation fetch failed: ' + err.message); });
  });

// ─── [V99] leaderboard — Validator leaderboard ───────────────────────────────
program
  .command('leaderboard')
  .description('Show top validator leaderboard sorted by reputation score.')
  .option('--url <url>',    'API base URL')
  .option('--limit <n>',    'Number of entries (default: 10)')
  .action(function(opts) {
    var base  = (opts.url || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    var limit = opts.limit || '10';
    request('GET', base + '/api/v1/validators/leaderboard?limit=' + limit, null, {}).then(function(resp) {
      if (resp.status !== 200) {
        console.error(r('Error ' + resp.status + ': ' + JSON.stringify(resp.body)));
        process.exit(1);
      }
      var vs = resp.body.validators || [];
      console.log(b('Validator Leaderboard'));
      console.log(dm('─'.repeat(70)));
      if (vs.length === 0) { console.log('  ' + dm('No validators yet.')); return; }
      vs.forEach(function(v) {
        var medal = v.rank === 1 ? '🥇' : v.rank === 2 ? '🥈' : v.rank === 3 ? '🥉' : ('#' + v.rank);
        console.log('  ' + medal + '  ' + cy(v.validatorId)
          + '  score=' + g(String(v.score))
          + '  tasks=' + v.totalTasks
          + '  earned=$' + v.totalEarned);
      });
    }).catch(function(err) { die('leaderboard failed: ' + err.message); });
  });

// ─── [V100] health — Simple and detailed health check ────────────────────────
program
  .command('health')
  .description('Check server health. Use --detailed for full subsystem check.')
  .option('--url <url>',      'API base URL')
  .option('--detailed',       'Fetch /api/v1/health/detailed with full subsystem checks')
  .action(function(opts) {
    var base = (opts.url || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    var endpoint = opts.detailed
      ? base + '/api/v1/health/detailed'
      : base + '/api/v1/health';

    request('GET', endpoint, null, {}).then(function(resp) {
      if (resp.status !== 200) {
        console.error(r('Error ' + resp.status + ': ' + JSON.stringify(resp.body)));
        process.exit(1);
      }
      var data = resp.body;

      if (!opts.detailed) {
        // Simple health
        var statusStr = data.status === 'ok' ? g('ok') : r(String(data.status));
        console.log(b('ECOS Health') + '  version=' + cy(data.version || '—') + '  status=' + statusStr);
        console.log('  uptime=' + fmtUptime(data.uptime || 0));
        console.log('  db=' + (data.db === 'connected' ? g('connected') : y('offline')));
        console.log('  selfRefinement=' + String(data.selfRefinement));
        return;
      }

      // Detailed health
      var overall = data.status;
      var statusColor = overall === 'healthy' ? g : overall === 'degraded' ? y : r;
      console.log(b('ECOS Detailed Health') + '  ' + statusColor(overall.toUpperCase()));
      console.log(dm('  version=' + data.version + '  uptime=' + fmtUptime(data.uptime || 0)));
      console.log(dm('─'.repeat(70)));

      var checks = data.checks || {};

      function statusIcon(s) {
        if (s === 'ok')          return g('✓');
        if (s === 'warning')     return y('⚠');
        if (s === 'unavailable') return y('—');
        return r('✗');
      }

      if (checks.database) {
        var db = checks.database;
        console.log('  database       ' + statusIcon(db.status) + '  latency=' + db.latencyMs + 'ms  ' + dm(db.message || ''));
      }
      if (checks.calibrator) {
        var cal = checks.calibrator;
        console.log('  calibrator     ' + statusIcon(cal.status) + '  samples=' + cal.sampleCount + '  ' + dm(cal.message || ''));
      }
      if (checks.auditChain) {
        var ch = checks.auditChain;
        console.log('  auditChain     ' + statusIcon(ch.status) + '  len=' + ch.length + '  verified=' + String(ch.verified));
      }
      if (checks.rateLimiter) {
        console.log('  rateLimiter    ' + g('✓') + '  activeKeys=' + checks.rateLimiter.activeKeys);
      }
      if (checks.eventLog) {
        console.log('  eventLog       ' + g('✓') + '  events=' + checks.eventLog.totalEvents);
      }
      if (checks.validatorHub) {
        var vh = checks.validatorHub;
        console.log('  validatorHub   ' + statusIcon(vh.status) + '  clients=' + vh.connectedClients);
      }
      if (checks.notifications) {
        console.log('  notifications  ' + g('✓') + '  webhooks=' + checks.notifications.registeredWebhooks);
      }
    }).catch(function(err) { die('health failed: ' + err.message); });
  });

// ─── [V100] export — Export audit report to stdout/file ──────────────────────
program
  .command('export')
  .description('Export audit report (JSON or CSV) to stdout or a file.')
  .option('--url <url>',      'API base URL')
  .option('--format <fmt>',   'Output format: json|csv (default: json)')
  .option('--from <iso>',     'Filter from ISO timestamp')
  .option('--to <iso>',       'Filter to ISO timestamp')
  .action(function(opts) {
    var base   = (opts.url || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    var params = new URLSearchParams();
    if (opts.format) params.set('format', opts.format);
    if (opts.from)   params.set('from',   opts.from);
    if (opts.to)     params.set('to',     opts.to);

    request('GET', base + '/api/v1/export/audit-report?' + params.toString(), null, {})
      .then(function(resp) {
        if (resp.status !== 200) {
          console.error(r('Error ' + resp.status + ': ' + JSON.stringify(resp.body)));
          process.exit(1);
        }
        var out = (opts.format === 'csv' && typeof resp.body === 'string')
          ? resp.body
          : JSON.stringify(resp.body, null, 2);
        process.stdout.write(out + '\n');
      })
      .catch(function(err) { die('export failed: ' + err.message); });
  });


// ─── [V117-P13-07] graduation — Show graduation stage for a validator ─────────
program
  .command('graduation')
  .description('Show graduation ladder stage and progress for a validator user.')
  .option('--userId <id>',  'Validator user ID (e.g. validator::alice_001)')
  .option('--url <url>',    'API base URL')
  .action(function(opts) {
    var userId = opts.userId;
    if (!userId) {
      console.error('Error: --userId is required (e.g. validator::alice_001)');
      process.exit(1);
    }
    var base = getBaseUrl(program.opts());
    if (opts.url) base = opts.url.replace(/\/$/, '');
    var url1 = base + '/api/v1/users/' + encodeURIComponent(userId) + '/graduation';
    var url2 = base + '/api/v1/validator/dashboard/' + encodeURIComponent(userId);
    request('GET', url1, null, {})
      .then(function(resp) {
        if (resp.status !== 200) return request('GET', url2, null, {});
        return resp;
      })
      .then(function(resp) {
        if (resp.status !== 200) {
          console.error(r('Error ' + resp.status + ': ' + JSON.stringify(resp.body)));
          process.exit(1);
        }
        var body = resp.body;
        var g = body.graduation || body.currentStage || body;
        var stageName = g.stageName || g.name || 'USE';
        var stageId   = g.stageId || 1;
        var stages    = ['USE','VERIFY','OWN','RECRUIT','MENTOR'];
        console.log('');
        console.log('Validator: ' + userId);
        console.log('Stage:     ' + stageName + ' (' + stageId + '/5)');
        if (g.unlockedAt) console.log('Unlocked:  ' + new Date(g.unlockedAt).toLocaleDateString());
        console.log('');
        var ladder = stages.map(function(s, i) {
          if (i + 1 < stageId)  return g_green('[✓ ' + s + ']');
          if (i + 1 === stageId) return g_yellow('[● ' + s + ']');
          return g_dim('[○ ' + s + ']');
        }).join(' → ');
        console.log('  ' + ladder);
        console.log('');
      })
      .catch(function(err) { die('graduation lookup failed: ' + err.message); });
  });

// ─── Parse ───────────────────────────────────────────────────────────────────
program.parse(process.argv);
