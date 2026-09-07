#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SAOS wave-2 fix probes: real curation APR from account history + supply keys + SE retry. READ-ONLY."""
import json
import urllib.request
from datetime import datetime, timezone

RPC = "https://api.steemit.com"
OUT = "scripts/chain_probes_wave2b_results.json"
results = {"ts": datetime.now(timezone.utc).isoformat()}


def rpc_call(method, params, timeout=45):
    body = json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def asset(s):
    try:
        a, b = s.split()
        return float(a), b
    except Exception:
        return 0.0, "?"


def get_history(account, pages=30, page_size=100):
    """paginate backwards: node caps get_account_history limit at 100."""
    out = []
    start = -1
    for i in range(pages):
        try:
            r = rpc_call("condenser_api.get_account_history", [account, start, page_size])
            hist = r.get("result")
            if hist is None:
                print(f"  page {i} err: {str(r.get('error'))[:80]}")
                break
        except Exception as e:
            print(f"  page {i} exc: {str(e)[:80]}")
            break
        if not hist:
            break
        out.extend(hist)
        if len(hist) < page_size:
            break
        start = hist[0][0] - 1          # oldest seq on this page - 1
    return out


def probe_curation(account, pages=30):
    print(f"== history: {account} ==", flush=True)
    hist = get_history(account, pages)
    acc = rpc_call("condenser_api.get_accounts", [[account]])["result"][0]
    VESTS_PER_SP = 324771199592.335691 / 200874696.676      # measured: ~1617 VESTS per 1 SP
    v_own, _ = asset(acc["vesting_shares"])
    v_recv, _ = asset(acc.get("received_vesting_shares", "0 VESTS"))
    v_del, _ = asset(acc.get("delegated_vesting_shares", "0 VESTS"))
    eff = v_own + v_recv - v_del

    cur_ts = []          # timestamps of curation ops
    cur_vests = 0.0
    vote_days = set()
    votes = 0
    weights = []
    for _, item in hist:
        typ, body = item["op"]
        ts = item["timestamp"][:10]
        if typ == "curation_reward":
            cur_ts.append(ts)
            v, _ = asset(body.get("reward", "0 VESTS"))
            cur_vests += v
        elif typ == "vote" and body.get("voter") == account:
            vote_days.add(ts)
            votes += 1
            weights.append(abs(body.get("weight", 0)) / 100.0)

    cur_days = sorted(set(cur_ts))
    if len(cur_days) >= 2:
        d0 = datetime.fromisoformat(cur_days[0] + "T00:00:00+00:00")
        d1 = datetime.fromisoformat(cur_days[-1] + "T00:00:00+00:00")
        span_days = max((d1 - d0).days, 1)
    else:
        span_days = 1
    daily_vests = cur_vests / span_days
    return {
        "effective_vests": round(eff, 1),
        "effective_SP_approx": round(eff / VESTS_PER_SP, 0),
        "window_span_days": span_days,
        "curation_vests_total": round(cur_vests, 1),
        "curation_vests_daily": round(daily_vests, 2),
        "curation_ops_in_window": len(cur_ts),
        "active_vote_days": len(vote_days),
        "votes_cast_in_window": votes,
        "avg_vote_weight_pct": round(sum(weights) / max(len(weights), 1), 1),
        "APR_curation_pct": round(daily_vests / max(eff, 1) * 365 * 100, 2),
        "votes_per_active_day": round(votes / max(len(vote_days), 1), 1),
    }


def probe_supply():
    gp = rpc_call("condenser_api.get_dynamic_global_properties", [])["result"]
    keep = {k: gp[k] for k in gp if "supply" in k or "vesting" in k}
    return keep


def probe_engine_retry():
    eps = ["https://api.steem-engine.net/rpc/contracts", "https://api.steem-engine.net/contracts",
           "https://scot-api.steem-engine.com/markets"]
    out = []
    import urllib.error
    for ep in eps:
        try:
            req = urllib.request.Request(ep, headers={"User-Agent": "SAOS/1.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                out.append({"ep": ep, "status": r.status})
        except Exception as e:
            out.append({"ep": ep, "err": str(e)[:80]})
    return out


results["supply_keys"] = probe_supply()
print(json.dumps(results["supply_keys"], indent=1)[:500])

cur = {}
for a in ["curie", "ocd", "steemcurator04", "bestoflife"]:
    try:
        cur[a] = probe_curation(a)
        print(json.dumps(cur[a]), flush=True)
    except Exception as e:
        cur[a] = {"error": str(e)[:150]}
results["curation_apr"] = cur

results["engine_retry"] = probe_engine_retry()
print("engine:", json.dumps(results["engine_retry"]))

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=1)
print(f"saved -> {OUT}")
