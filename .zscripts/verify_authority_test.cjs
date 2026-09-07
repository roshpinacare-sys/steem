#!/usr/bin/env node
/**
 * verify_authority_test.cjs — Task 21-a empirical proof (read-only + fake key).
 *
 * Questions answered empirically per node (api.steemit.com / api.justyy.com / steem.fans):
 *   1. Does condenser_api.verify_authority exist and what EXACTLY does it return
 *      for a transaction signed with a WRONG (fake, locally derived) posting WIF?
 *      Expectation: `false` or an error like "Missing Posting Authority headcorner".
 *   2. Does the full broadcast path (sendAsync) reject the same tx with
 *      "Missing Posting Authority headcorner"? (documents the fallback-path rejection)
 *
 * IRON RULE: the WIF here is DERIVED LOCALLY from a fake master password
 * ('saos-test-1') — it is NOT a real key and signs nothing of value. The claim op
 * amounts are fetched LIVE from get_accounts (the real pending 26.310 SP claim).
 * Nothing is ever broadcast successfully by this script.
 */
const steem = require('steem')

const ACCOUNT = 'headcorner'
const FAKE_MASTER = 'saos-test-1'
const NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://steem.fans']

const j = (o) => JSON.stringify(o)
const p = (s) => console.log(s)

function withTimeout(ms, label, fn) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms)
    Promise.resolve()
      .then(fn)
      .then((r) => { clearTimeout(t); resolve(r) })
      .catch((e) => { clearTimeout(t); reject(e) })
  })
}

/** Raw jsonrpc POST (no library) — for the reference claim-amount fetch. */
async function rawRpc(url, method, params) {
  const res = await withTimeout(15000, `rawRpc ${method}`, () =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: j({ jsonrpc: '2.0', method, params, id: 1 }),
    }),
  )
  const json = await res.json()
  if (json.error) throw new Error(`${method}: ${json.error.message ?? j(json.error)}`)
  return json.result
}

/** Promise wrapper around steem.api.call(method, params). */
function apiCall(method, params) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`api.call ${method}: timeout after 15000ms`)), 15000)
    try {
      steem.api.call(method, params, (err, result) => {
        clearTimeout(t)
        if (err) reject(err)
        else resolve(result)
      })
    } catch (e) { clearTimeout(t); reject(e) }
  })
}

/** Promise wrapper around the legacy database_api route. */
function apiVerifyAuthority(signedTx) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('api.verifyAuthority: timeout after 15000ms')), 15000)
    try {
      steem.api.verifyAuthority(signedTx, (err, result) => {
        clearTimeout(t)
        if (err) reject(err)
        else resolve(result)
      })
    } catch (e) { clearTimeout(t); reject(e) }
  })
}

function describeErr(e) {
  if (!e) return '(null)'
  if (typeof e === 'string') return e
  if (e.message) return `message=${j(e.message)}${e.data ? ` data=${j(e.data)}` : ''}`
  try { return j(e) } catch { return String(e) }
}

async function main() {
  p('═══ Task 21-a — verify_authority empirical test ═══')
  p(`steem-js version: ${require('steem/package.json').version}`)

  // 1. Fake key, derived 100% locally (never a real key).
  const keys = steem.auth.getPrivateKeys(ACCOUNT, FAKE_MASTER, ['posting'])
  const wif = keys.posting
  p(`\n[1] FAKE posting WIF derived locally from master '${FAKE_MASTER}': ${j(wif.slice(0, 8))}… isWif=${steem.auth.isWif(wif)} pubkey=${keys.postingPubkey}`)

  // 2. Live claim amounts from the chain (real pending rewards).
  const [acc] = await rawRpc(NODES[0], 'condenser_api.get_accounts', [[ACCOUNT]])
  if (!acc) throw new Error('account fetch failed')
  p(`\n[2] LIVE pending rewards for @${ACCOUNT}: reward_steem=${acc.reward_steem_balance} reward_sbd=${acc.reward_sbd_balance} reward_vests=${acc.reward_vesting_balance}`)
  const claimOp = ['claim_reward_balance', {
    account: ACCOUNT,
    reward_steem: acc.reward_steem_balance,
    reward_sbd: acc.reward_sbd_balance,
    reward_vests: acc.reward_vesting_balance,
  }]
  p(`    claim op: ${j(claimOp)}`)

  for (const node of NODES) {
    p(`\n═══════ NODE: ${node} ═══════`)
    try {
      steem.api.setOptions({ url: node, useAppbaseApi: false })

      // 3. Prepare tx locally (library path: DGP + block header → ref_block_num/prefix), expiration ~60s.
      const prepared = await withTimeout(20000, '_prepareTransaction', () =>
        steem.broadcast._prepareTransaction({ operations: [claimOp], extensions: [] }),
      )
      prepared.expiration = new Date(Date.now() + 60 * 1000) // ~60s per spec (library default is 600s)
      p(`[3] prepared tx: ref_block_num=${prepared.ref_block_num} ref_block_prefix=${prepared.ref_block_prefix} expiration=${new Date(prepared.expiration).toISOString()}`)

      // 4. Sign locally with the FAKE WIF.
      const signed = steem.auth.signTransaction(prepared, [wif])
      p(`[4] signed locally: ${signed.signatures.length} signature(s), first=${j(String(signed.signatures[0]).slice(0, 16))}…`)

      // 5. verify_authority — condenser route.
      try {
        const res = await apiCall('condenser_api.verify_authority', [signed])
        p(`[5] condenser_api.verify_authority RESULT: ${j(res)}`)
      } catch (e) {
        p(`[5] condenser_api.verify_authority ERROR: ${describeErr(e)}`)
      }

      // 6. verify_authority — legacy database_api route (what steem.api.verifyAuthority wraps).
      try {
        const res = await apiVerifyAuthority(signed)
        p(`[6] database_api verify_authority (steem.api.verifyAuthority) RESULT: ${j(res)}`)
      } catch (e) {
        p(`[6] database_api verify_authority (steem.api.verifyAuthority) ERROR: ${describeErr(e)}`)
      }

      // 7. Fallback path sanity: real broadcast attempt with the fake key must be
      //    rejected by the chain itself (documents the error the fallback relies on).
      try {
        const conf = await withTimeout(25000, 'sendAsync', () =>
          steem.broadcast.sendAsync(
            { operations: [claimOp], extensions: [] },
            [wif],
          ),
        )
        p(`[7] sendAsync UNEXPECTEDLY ACCEPTED: ${j(conf)}`)
      } catch (e) {
        p(`[7] sendAsync broadcast REJECTED (expected): ${describeErr(e)}`)
      }
    } catch (e) {
      p(`!! node-level failure: ${describeErr(e)}`)
    }
  }

  p('\n═══ done — nothing was broadcast (fake key) ═══')
}

main().catch((e) => { p(`FATAL: ${describeErr(e)}`); process.exit(1) })
