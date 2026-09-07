#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAOS — Chain probes wave 2 (READ-ONLY).
Measures, live from the public Steem RPC + sidechain APIs:
  1. Reward fund (post) — the real curation pool right now
  2. Real curation income of known curation accounts (account history) -> empirical curation APR
  3. Account-creation economy: account_creation_fee + pending_claimed_accounts on big accounts
  4. Recurring transfers feature availability (HF24)
  5. Steem-Engine (L2) token markets: top tokens by volume, spreads on STEEMP pairs
  6. dLease rental listings (empirical SP-rental APR)
No keys are used, no writes are broadcast. Results -> scripts/chain_probes_wave2_results.json
"""
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

RPC = "https://api.steemit.com"
OUT = "scripts/chain_probes_wave2_results.json"
results = {"ts": datetime.now(timezone.utc).isoformat(), "probes": {}}


def rpc_call(method, params=None, timeout=25):
    body = json.dumps({"jsonrpc": "2.0", "method": method,
                       "params": params if params is not None else [], "id": 1}).encode()
    req = urllib.request.Request(RPC, data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def http_json(url, payload=None, timeout=25):
    if payload is None:
        req = urllib.request.Request(url, headers={"User-Agent": "SAOS-research/1.0"})
    else:
        req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json",
                                              "User-Agent": "SAOS-research/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def asset(s):
    """'123.456 ABC' -> (float, 'ABC')"""
    try:
        a, b = s.split()
        return float(a), b
    except Exception:
        return 0.0, "?"


# ---------------------------------------------------------------- probe 1: reward fund
def probe_reward_fund():
    rf = rpc_call("condenser_api.get_reward_fund", ["post"])["result"]
    gp = rpc_call("condenser_api.get_dynamic_global_properties")["result"]
    reward_balance_sbd, _ = asset(rf.get("reward_balance", "0.000 SBD"))
    recent_claims = float(rf.get("recent_claims", 0))
    total_vesting_shares, vunit = asset(gp.get("total_vesting_shares", "0 VESTS"))
    total_vesting_fund, _ = asset(gp.get("total_vesting_fund_shares", "0 STEEM"))
    steem_supply, _ = asset(gp.get("supply", "0 STEEM"))
    sbd_supply, _ = asset(gp.get("current_sbd_supply", "0 SBD"))
    return {
        "reward_balance_sbd_24h_pool": reward_balance_sbd,
        "recent_claims": recent_claims,
        "total_vesting_shares": total_vesting_shares,
        "vests_unit": vunit,
        "total_vesting_fund_steem": total_vesting_fund,
        "steem_supply": steem_supply,
        "sbd_supply": sbd_supply,
        "note": "reward_balance = the SBD pool paid to curators over the current payout window",
    }


# ---------------------------------------------------------------- probe 2: real curation income
CURATION_ACCOUNTS = ["curie", "ocd", "bestoflife", "steemcurator04"]


def probe_curation_income(account, lookback=3000):
    """Pull recent history, sum curation_reward ops (paid in VESTS), estimate 7d APR."""
    hist = rpc_call("condenser_api.get_account_history",
                    [account, -1, lookback], timeout=40)["result"]
    acc = rpc_call("condenser_api.get_accounts", [[account]])["result"][0]
    vests_own, _ = asset(acc.get("vesting_shares", "0 VESTS"))
    vests_recv, _ = asset(acc.get("received_vesting_shares", "0 VESTS"))
    vests_dele, _ = asset(acc.get("delegated_vesting_shares", "0 VESTS"))
    effective_vests = vests_own + vests_recv - vests_dele

    rewards = []          # (ts, vests)
    author_rewards = 0.0
    for blk, _, op in hist:
        typ = op[0]
        ts = op[1].get("timestamp")
        if typ == "curation_reward":
            v, _ = asset(op[1].get("reward", "0 VESTS"))
            rewards.append((ts, v))
        elif typ == "author_reward":
            sv, _ = asset(op[1].get("sbd_payout", "0 SBD"))
            vv, _ = asset(op[1].get("vesting_payout", "0 VESTS"))
            author_rewards += sv  # only sbd part counted, conservative

    if not rewards:
        return {"account": account, "curation_ops_found": 0, "note": "no curation ops in window"}

    rewards.sort(key=lambda x: x[0])
    t0 = datetime.fromisoformat(rewards[0][0].replace("Z", "+00:00"))
    t1 = datetime.fromisoformat(rewards[-1][0].replace("Z", "+00:00"))
    days = max((t1 - t0).total_seconds() / 86400.0, 0.02)
    vests_sum = sum(v for _, v in rewards)
    daily_vests = vests_sum / days
    # SP conversion: global ratio ~ total_vesting_fund/total_vesting_shares (probe 1 handles precision)
    # approximate with 1 SP = 2.06 VESTS only as fallback marker; real calc in doc uses chain ratio
    return {
        "account": account,
        "window_days": round(days, 2),
        "curation_ops": len(rewards),
        "vests_curation_total": round(vests_sum, 2),
        "vests_curation_daily_avg": round(daily_vests, 2),
        "effective_vests": round(effective_vests, 2),
        "author_sbd_in_window": round(author_rewards, 2),
        "curation_vests_per_effective_vest_per_day": round(daily_vests / max(effective_vests, 1), 8),
    }


# ---------------------------------------------------------------- probe 3: account creation economy
def probe_account_creation():
    ws = rpc_call("condenser_api.get_witness_schedule")["result"]
    mp = ws.get("median_props", {})
    fee, unit = asset(mp.get("account_creation_fee", "0 STEEM"))
    candidates = ["justyy", "upvu.witness", "steemchiller", "ety001", "h4lab.witness",
                  "steem-supportingcoin", "sbi3", "sbi2", "sbi4"]
    accs = rpc_call("condenser_api.get_accounts", [candidates])["result"]
    claimed = {}
    for a in accs:
        if a:
            claimed[a["name"]] = {
                "pending_claimed_accounts": a.get("pending_claimed_accounts", 0),
                "vesting_shares": asset(a.get("vesting_shares", "0 VESTS"))[0],
            }
    return {
        "account_creation_fee": f"{fee} {unit}",
        "fee_in_steem": fee,
        "fee_usd_hint": "fee is burned to claim accounts; claimed accounts can be created free (create_claimed_account)",
        "big_accounts_pending_claims": claimed,
    }


# ---------------------------------------------------------------- probe 4: recurring transfers (HF24)
def probe_recurring_transfers():
    out = {}
    for acc in ["justyy", "steemchiller"]:
        try:
            r = rpc_call("condenser_api.get_account_recurring_transfers", [acc, 0, 20])
            out["available_on"] = acc
            out["result_shape_keys"] = sorted((r["result"] or {}).keys()) if isinstance(r.get("result"), dict) else type(r.get("result")).__name__
            break
        except urllib.error.HTTPError as e:
            out[acc] = f"HTTP {e.code}: {e.read()[:120].decode(errors='ignore')}"
        except Exception as e:
            out[acc] = f"ERR {e}"
    return out


# ---------------------------------------------------------------- probe 5: Steem-Engine L2 markets
def probe_steem_engine():
    out = {"endpoints_tried": []}
    endpoints = ["https://api.steem-engine.net/rpc/contracts",
                 "https://api.steem-engine.com/rpc/contracts"]
    tokens = None
    for ep in endpoints:
        try:
            r = http_json(ep, {"jsonrpc": "2.0", "method": "find",
                               "params": {"contract": "tokens", "table": "tokens",
                                          "query": {"active": True}, "limit": 1000}, "id": 1})
            tokens = r.get("result")
            out["endpoints_tried"].append({"endpoint": ep, "ok": bool(tokens), "n": len(tokens) if tokens else 0})
            if tokens:
                out["working_endpoint"] = ep
                break
        except Exception as e:
            out["endpoints_tried"].append({"endpoint": ep, "error": str(e)[:100]})
    if not tokens:
        out["error"] = "no working SE endpoint"
        return out

    sym2token = {t["symbol"]: t for t in tokens}
    metrics = []
    for ep in [out.get("working_endpoint")]:
        try:
            r = http_json(ep, {"jsonrpc": "2.0", "method": "find",
                               "params": {"contract": "market", "table": "metrics",
                                          "query": {}, "limit": 500}, "id": 1})
            metrics = r.get("result") or []
        except Exception as e:
            out["metrics_error"] = str(e)[:120]
    steemp = sym2token.get("STEEMP", {})
    top = []
    for m in metrics:
        try:
            vol = float(m.get("volume", 0) or 0)          # volume in STEEMP for STEEMP pairs
            last = float(m.get("lastPrice", 0) or 0)
            bid = float(m.get("highestBid", 0) or 0)
            ask = float(m.get("lowestAsk", 0) or 0)
            sym = m.get("symbol")
            if sym == "STEEMP" or vol <= 0:
                continue
            spread = (ask - bid) / ask if ask > 0 else None
            top.append({"symbol": sym, "volume_steemp_24h_like": round(vol, 2),
                        "last": last, "bid": bid, "ask": ask,
                        "spread_pct": round(spread * 100, 2) if spread else None,
                        "name": sym2token.get(sym, {}).get("name", "")[:40]})
        except Exception:
            continue
    top.sort(key=lambda x: -x["volume_steemp_24h_like"])
    out["n_tokens_active"] = len(tokens)
    out["n_markets_with_volume"] = len(top)
    out["top_markets"] = top[:12]
    out["steemp_supply"] = steemp.get("supply")
    return out


# ---------------------------------------------------------------- probe 6: dLease listings
def probe_dlease():
    out = {"tried": []}
    urls = ["https://dlease.io/api/listings?page=1",
            "https://dlease.io/api/market?limit=20",
            "https://dlease.io/api/activeRentals?limit=20"]
    for u in urls:
        try:
            r = http_json(u)
            out["tried"].append({"url": u, "ok": True, "keys": sorted(r.keys())[:8] if isinstance(r, dict) else "list"})
            out["first_payload_sample"] = json.dumps(r, ensure_ascii=False)[:400]
            out["working_url"] = u
            break
        except Exception as e:
            out["tried"].append({"url": u, "error": str(e)[:90]})
    return out


def main():
    probes = results["probes"]
    print("== probe 1: reward fund ==", flush=True)
    try:
        probes["reward_fund"] = probe_reward_fund()
        print(json.dumps(probes["reward_fund"], indent=1)[:600])
    except Exception as e:
        probes["reward_fund"] = {"error": str(e)}

    print("== probe 2: real curation income ==", flush=True)
    cur = {}
    for a in CURATION_ACCOUNTS:
        try:
            cur[a] = probe_curation_income(a)
            print(a, "->", json.dumps(cur[a])[:200], flush=True)
        except Exception as e:
            cur[a] = {"error": str(e)[:120]}
    probes["curation_income"] = cur

    print("== probe 3: account creation ==", flush=True)
    try:
        probes["account_creation"] = probe_account_creation()
    except Exception as e:
        probes["account_creation"] = {"error": str(e)}

    print("== probe 4: recurring transfers ==", flush=True)
    try:
        probes["recurring_transfers"] = probe_recurring_transfers()
    except Exception as e:
        probes["recurring_transfers"] = {"error": str(e)}

    print("== probe 5: steem-engine L2 ==", flush=True)
    try:
        probes["steem_engine"] = probe_steem_engine()
        print(json.dumps(probes["steem_engine"], indent=1)[:900])
    except Exception as e:
        probes["steem_engine"] = {"error": str(e)}

    print("== probe 6: dlease ==", flush=True)
    try:
        probes["dlease"] = probe_dlease()
        print(json.dumps(probes["dlease"], indent=1)[:500])
    except Exception as e:
        probes["dlease"] = {"error": str(e)}

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    print(f"\nsaved -> {OUT}")


if __name__ == "__main__":
    main()
