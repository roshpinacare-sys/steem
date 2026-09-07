#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
auto_scan.py — Task 19a: chain-derived census for NEW automated mechanisms.
READ-ONLY, api.steemit.com only, zero web. Method = docs/ROAST.md.

Measures:
  1. Op-type census over a live block sample (what is actually USED on-chain)
  2. custom_json protocol census (which app-layers are alive today)
  3. Account-creation market (claim_account / create_claimed_account / paid create_account)
  4. Rare-op usage: delegate_rc, escrow_*, recurrent_transfer, proposal ops
  5. RC economics for headcorner (regen/day, max_rc)
  6. Fresh curation APR estimate from headcorner's own curation rewards
  7. Internal market maker feasibility (depth at ±1% around mid)
"""
import json, time, urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

RPC = "https://api.steemit.com"
_id = [5000]
_lock = __import__("threading").Lock()

def rpc(method, params, timeout=25):
    body = json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        out = json.loads(r.read().decode())
    if "error" in out:
        raise RuntimeError(f"{method}: {out['error'].get('message','?')[:120]}")
    return out["result"]

def num(a):
    try: return float(str(a).split(" ")[0])
    except Exception: return 0.0

out = {"measuredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

# ── head block ──────────────────────────────────────────────────────────────
dgp = rpc("condenser_api.get_dynamic_global_properties", [])
head = dgp["head_block_number"]
out["head_block"] = head

# ── 1+2+3+4: op census over SAMPLE blocks ──────────────────────────────────
SAMPLE = 600          # ~30 min of chain at 3s blocks
START = head - 3000   # skip the freshest edge
RARE = {"claim_account", "create_claimed_account", "create_account",
        "delegate_rc", "escrow_transfer", "escrow_approve", "escrow_release",
        "recurrent_transfer", "update_proposal_votes"}

def scan_block(b):
    ops = rpc("condenser_api.get_ops_in_block", [b, False], timeout=15)
    block_ops, block_cj, block_rare = [], [], []
    for entry in ops:
        op = entry.get("op", [])
        if isinstance(op, dict):
            otype, odata = op.get("type", "?").replace("_operation", ""), op.get("value", {})
        else:
            otype, odata = op[0], op[1]
        block_ops.append(otype)
        if otype == "custom_json":
            block_cj.append(str(odata.get("id", "?")))
        elif otype in RARE:
            block_rare.append((otype, b, json.dumps(odata)[:100]))
    return block_ops, block_cj, block_rare

t0 = time.time()
op_counter, cj_counter, crisis = Counter(), Counter(), []
with ThreadPoolExecutor(max_workers=12) as ex:
    for block_ops, block_cj, block_rare in ex.map(scan_block, range(START, START + SAMPLE)):
        op_counter.update(block_ops)
        cj_counter.update(block_cj)
        crisis.extend(block_rare)
scan_s = time.time() - t0
blocks_per_day = 86400 / 3.0
scale = blocks_per_day / SAMPLE
out["census"] = {
    "sample_blocks": SAMPLE, "scan_seconds": round(scan_s, 1),
    "ops_total": sum(op_counter.values()),
    "op_types_per_day_est": {k: round(v * scale) for k, v in op_counter.most_common(25)},
    "custom_json_ids_per_day_est": {k: round(v * scale) for k, v in cj_counter.most_common(20)},
    "rare_ops_seen": crisis[:40],
}

# ── 5: RC economics ─────────────────────────────────────────────────────────
rc = rpc("rc_api.find_rc_accounts", {"accounts": ["headcorner"]})["rc_accounts"][0]
max_rc = int(rc["max_rc"]); cur = int(rc["rc_manabar"]["current_mana"])
out["rc"] = {
    "max_rc": max_rc, "current": cur, "full_recharge_days": 5,
    "regen_per_day": max_rc // 5, "regen_per_hour": max_rc // 120,
    "pct": round(100.0 * cur / max_rc, 2) if max_rc else 0,
}

# pending claimed accounts of the two known factories
fact = {}
for acc in ("upvu", "justyy"):
    try:
        a = rpc("condenser_api.get_accounts", [[acc]])[0]
        fact[acc] = {"pending_claimed_accounts": a.get("pending_claimed_accounts"),
                     "post_count": a.get("post_count")}
    except Exception:
        fact[acc] = None
out["factories"] = fact

# ── 6: curation APR from headcorner's own recent curation rewards ──────────
try:
    hist = rpc("condenser_api.get_account_history", ["headcorner", -1, 500])
    entries = hist if isinstance(hist, list) else hist.get("history", [])
    cur_rewards, ts_first, ts_last = [], None, None
    vests2sp = num(dgp["total_vesting_fund_steem"]) / num(dgp["total_vesting_shares"])
    for idx, entry in entries:
        block = entry.get("block"); ts = entry.get("timestamp")
        for op in entry.get("op", [[]]):
            otype = op[0] if isinstance(op, list) and op else None
            if otype == "curation_reward":
                rew = num(op[1].get("reward", "0")) * vests2sp
                cur_rewards.append({"sp": rew, "ts": ts})
    if cur_rewards:
        days = 7.0
        week = [c for c in cur_rewards if True][-len(cur_rewards):]
        total_sp7 = sum(c["sp"] for c in cur_rewards)
        sp_own = num(rpc("condenser_api.get_accounts", [["headcorner"]])[0]["vesting_shares"]) * vests2sp
        apr_est = (total_sp7 / max(sp_own, 1)) * (365.0 / 7) * 100
        out["curation"] = {
            "rewards_last500ops": len(cur_rewards),
            "total_sp_last500ops": round(total_sp7, 4),
            "sp_own": round(sp_own, 1),
            "apr_pct_est": round(apr_est, 2),
            "note": "מבוסס על 500 האופס האחרונים (חלון לא אחיד) — הערכה בלבד",
        }
    else:
        out["curation"] = {"rewards_last500ops": 0}
except Exception as e:
    out["curation"] = {"error": str(e)[:120]}

# ── 7: market maker feasibility (depth ±1% around mid) ──────────────────────
book = rpc("condenser_api.get_order_book", [50])
bids = [(num(x.get("real_price", "0")), num(x.get("steem", "0"))) for x in book.get("bids", [])]
asks = [(num(x.get("real_price", "0")), num(x.get("steem", "0"))) for x in book.get("asks", [])]
if bids and asks:
    mid = (bids[0][0] + asks[0][0]) / 2
    bid_depth_1pct = sum(s for p, s in bids if p >= mid * 0.99)
    ask_depth_1pct = sum(s for p, s in asks if p <= mid * 1.01)
    spread_pct = (asks[0][0] - bids[0][0]) / mid * 100
    out["maker"] = {
        "mid": round(mid, 5), "spread_pct": round(spread_pct, 3),
        "bid_depth_steem_within_1pct": round(bid_depth_1pct, 1),
        "ask_depth_steem_within_1pct": round(ask_depth_1pct, 1),
        "note": "עומק בטווח ±1% — מדד כנה לפוטנציאל מייקר",
    }

with open(".zscripts/auto_scan_results.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print(json.dumps(out, ensure_ascii=False, indent=1)[:3500])
