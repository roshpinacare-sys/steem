#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RENTAL MARKET SCAN v2 — chain-only verification of the SP-rental APR.
Runbook task: "סריקת שוק ההשכרת SP והזרמת השכרה ראשונה" (Stage-1 gate, docs/ROAST.md §5).
READ-ONLY, api.steemit.com only, zero web — derive from the chain, not from websites.

v2 corrections (v1 probed API semantics and failed honestly):
  - condenser_api.get_vesting_delegations(acc,...) lists OUTGOING delegations only
    (verified: headcorner has 247 SP incoming, method returns []).
  - database_api.list_vesting_delegations does not exist on this node.
  - get_account_history accepts exactly 3 args (no op-filter) → unfiltered pagination.

Method:
  A) Discover delegates: paginate each candidate's raw history; collect
     delegate_vesting_shares ops where delegatee == candidate (incoming) →
     unique delegators + latest amounts; also count claim_account ops (account factory).
  B) Verify CURRENT state: for a sample of discovered delegators, read their OUTGOING
     delegation list and confirm the live amount to the candidate (1 call each).
  C) Measure payments: paginate each verified delegator's history (~800 raw ops),
     collect inbound transfers FROM the candidate, infer APR:
        APR = payments_in_window(STEEM units, SBD×ask) × 365 / window_days / delegated_SP
  D) Aggregate medians; save .zscripts/rental_scan_results.json
"""
import json, urllib.request, statistics, datetime, time, os, collections

RPC = "https://api.steemit.com"
_id = [7000]
SLEEP = 0.12

def rpc(method, params, retries=3):
    last = None
    for i in range(retries):
        try:
            _id[0] += 1
            req = urllib.request.Request(RPC, data=json.dumps({
                "jsonrpc": "2.0", "method": method, "params": params, "id": _id[0]
            }).encode(), headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                j = json.loads(r.read())
            if "error" in j:
                raise RuntimeError(j["error"].get("message"))
            return j["result"]
        except Exception as e:
            last = e
            time.sleep(1.0 + i)
    raise RuntimeError(f"{method}: {last}")

def num(a):
    return float(a.split(" ")[0]) if isinstance(a, str) and a else (float(a or 0))

def ts(s):
    return datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%S")

def section(t):
    print("\n" + "=" * 72)
    print(t)
    print("=" * 72)

dgp = rpc("condenser_api.get_dynamic_global_properties", [])
VEST2SP = num(dgp["total_vesting_fund_steem"]) / num(dgp["total_vesting_shares"])
ob = rpc("condenser_api.get_order_book", [10])
ASK = float(ob["asks"][0]["real_price"]) if ob.get("asks") else None
print(f"VEST2SP={VEST2SP:.10f}  head_block={dgp['head_block_number']}  ask={ASK} SBD/STEEM")

import os
CANDIDATES = os.environ.get("RENTAL_CANDIDATES", "upvu,upvu.bank").split(",")
PAYER_ALIASES = {"upvu": ["upvu", "upvu.bank"]}   # who actually pays the rent
DISCOVER_PAGES = int(os.environ.get("RENTAL_PAGES", "60"))
DISCOVER_STOP_DELEGATORS = 30
PAY_PAGES = 12             # ~1,200 raw ops per sampled delegator
SAMPLE_N = 14

# ── A) discovery via raw history pagination ──────────────────────────────────
discovered = {}
stats_ctx = {}
section("A) delegate discovery — paginating candidate history (delegatee == candidate)")
for c in CANDIDATES:
    dels = {}
    claim_accounts = 0
    transfers_out = collections.Counter()  # recipient -> SBD-equivalent-ish units
    n_transfers_out = 0
    opmix = collections.Counter()
    low = -1
    max_ts = None
    min_ts = None
    pages = 0
    try:
        for p in range(DISCOVER_PAGES):
            batch = rpc("condenser_api.get_account_history", [c, low if low >= 0 else -1, 99])
            pages += 1
            time.sleep(SLEEP)
            if not batch:
                break
            for idx, op in batch:
                t_ = op["timestamp"]
                if max_ts is None or t_ > max_ts:
                    max_ts = t_
                if min_ts is None or t_ < min_ts:
                    min_ts = t_
                name = op["op"][0]
                opmix[name] += 1
                if name == "delegate_vesting_shares":
                    b = op["op"][1]
                    if b.get("delegatee") == c:
                        dels[b["delegator"]] = (num(b["vesting_shares"]), t_)
                elif name == "claim_account":
                    claim_accounts += 1
                elif name == "transfer":
                    b = op["op"][1]
                    if b.get("from") == c:
                        amt = b.get("amount", "")
                        v = num(amt)
                        unit = "SBD" if amt.endswith("SBD") else ("STEEM" if amt.endswith("STEEM") else 0.0)
                        val = v * (ASK or 0.0) if unit == "STEEM" else v
                        transfers_out[b.get("to")] += val
                        n_transfers_out += 1
            # pagination fix: batches are ASCENDING within → lowest index is batch[0][0]
            low = batch[0][0]
            if low <= 0:
                break
            if len(dels) >= DISCOVER_STOP_DELEGATORS:
                break
    except Exception as e:
        print(f"  [{c}] FAILED at page {pages}: {e}")
        continue
    span_days = (ts(max_ts) - ts(min_ts)).total_seconds() / 86400.0 if min_ts and max_ts else 0.0
    tot_sp = sum(v * VEST2SP for v, _ in dels.values())
    top_pay = ", ".join(f"{k}:{v:,.1f}" for k, v in transfers_out.most_common(3))
    print(f"  [{c}] pages={pages} uniqOps~={pages*100} span={span_days:.2f}d "
          f"in_delegators={len(dels)} inSP={tot_sp:,.0f} claim_acc={claim_accounts} "
          f"transfers_out={n_transfers_out} top_to=[{top_pay}]")
    if len(dels) >= 10:
        discovered[c] = dels
        stats_ctx[c] = {"pages": pages, "span_days": round(span_days, 2),
                        "claim_account_ops": claim_accounts,
                        "transfers_out": n_transfers_out,
                        "opmix": dict(opmix.most_common(6))}
    elif len(dels) > 0:
        print(f"    ↳ too few incoming-delegate ops in window — not verifiable as rental hub now")
    else:
        print(f"    ↳ zero incoming-delegate ops in window; opmix={dict(opmix.most_common(4))}")

if not discovered:
    print("\nNO VALID RENTAL INTERMEDIARIES FOUND ON-CHAIN — continuing to context summary.")
    section("A2) account-factory signal (claim_account rate from scanned windows)")
    for c, ctx in stats_ctx.items():
        per_day = ctx["claim_account_ops"] / ctx["span_days"] if ctx["span_days"] > 0 else 0.0
        print(f"  {c:<18} claim_account={ctx['claim_account_ops']:>5} in {ctx['span_days']:>7.2f}d window "
              f"→ {per_day:>10.1f}/day   transfers_out={ctx['transfers_out']}")
    out = {"measured_at": datetime.datetime.now().isoformat(),
           "head_block": dgp["head_block_number"], "vest2sp": VEST2SP,
           "ask_sbd_per_steem": ASK, "intermediaries": {}, "context": stats_ctx,
           "conclusion": "no_rental_intermediary_verifiable_on_chain"}
    with open(".zscripts/rental_scan_results.json", "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print("\nsaved → .zscripts/rental_scan_results.json")
    raise SystemExit(0)

# ── B) current-state verification (delegator outgoing list) ──────────────────
section("B) current-state verification — sampled delegators")
verified = {}
for c, dels in discovered.items():
    keys = sorted(dels.keys())
    sample = keys[::max(1, len(keys) // SAMPLE_N)][:SAMPLE_N]
    ok = {}
    for dgr in sample:
        try:
            outs = rpc("condenser_api.get_vesting_delegations", [dgr, "", 1000]) or []
            time.sleep(SLEEP)
        except Exception:
            continue
        cur = [o for o in outs if o.get("delegatee") == c]
        if cur:
            sp = sum(num(o["vesting_shares"]) for o in cur) * VEST2SP
            if sp >= 5:
                ok[dgr] = sp
    verified[c] = ok
    print(f"  [{c}] verified={len(ok)}/{len(sample)}  SP: {', '.join(f'{k}:{v:,.0f}' for k, v in list(ok.items())[:6])}")

# ── C) payment measurement per verified delegator ────────────────────────────
section("C) payment measurement")
results = {}
for c, ok in verified.items():
    rows = []
    for dgr, sp in ok.items():
        try:
            pages = [rpc("condenser_api.get_account_history", [dgr, -1, 99])]
            time.sleep(SLEEP)
            low = pages[0][0][0]
            for _ in range(PAY_PAGES - 1):
                if low <= 0:
                    break
                nxt = rpc("condenser_api.get_account_history", [dgr, low - 1, 99])
                time.sleep(SLEEP)
                if not nxt:
                    break
                pages.append(nxt)
                low = nxt[0][0]
        except Exception as e:
            print(f"  @{dgr:<16} history FAILED: {e}")
            continue
        seen = {}
        for page in pages:
            for idx, op in page:
                seen[idx] = op
        ops = [seen[k] for k in sorted(seen)]
        if not ops:
            continue
        span_days = (ts(ops[-1]["timestamp"]) - ts(ops[0]["timestamp"])).total_seconds() / 86400.0
        pay_steem = pay_sbd = rev_steem = rev_sbd = 0.0
        pays = []
        for op in ops:
            body = op.get("op") or [None, {}]
            if body[0] != "transfer":
                continue
            b = body[1]
            amt = b.get("amount", "")
            unit = "SBD" if amt.endswith("SBD") else ("STEEM" if amt.endswith("STEEM") else "?")
            v = num(amt)
            if b.get("from") in PAYER_ALIASES.get(c, [c]):
                if unit == "SBD":
                    pay_sbd += v
                elif unit == "STEEM":
                    pay_steem += v
                pays.append({"ts": op["timestamp"], "unit": unit, "amt": v, "memo": (b.get("memo") or "")[:80]})
            elif b.get("to") == c:
                if unit == "SBD":
                    rev_sbd += v
                elif unit == "STEEM":
                    rev_steem += v
        pay_units = pay_steem + pay_sbd * (ASK or 0.0)
        apr = pay_units * 365.0 / span_days / sp * 100.0 if span_days >= 0.5 and sp > 0 else None
        rows.append({
            "delegator": dgr, "sp": round(sp, 1), "window_days": round(span_days, 1),
            "pay_steem": round(pay_steem, 3), "pay_sbd": round(pay_sbd, 3),
            "pay_units_steem": round(pay_units, 3), "n_payments": len(pays),
            "reverse_steem": round(rev_steem, 3), "reverse_sbd": round(rev_sbd, 3),
            "apr_pct": round(apr, 2) if apr is not None else None,
            "cadence_days": round(span_days / len(pays), 1) if len(pays) >= 2 else None,
            "sample_memo": pays[0]["memo"] if pays else "",
        })
        a = f"{apr:6.2f}%" if apr is not None else "   n/a"
        print(f"  @{dgr:<16} SP={sp:>9,.0f} win={span_days:>6.1f}d pays={len(pays):>3} "
              f"+{pay_steem:.2f}ST +{pay_sbd:.2f}SB APR={a}")
    okrows = [r for r in rows if r["apr_pct"] is not None]
    results[c] = {
        "discovered_delegators": len(discovered[c]),
        "context": stats_ctx.get(c, {}),
        "sampled": len(rows),
        "with_payments": len(okrows),
        "apr_median_pct": round(statistics.median([r["apr_pct"] for r in okrows]), 2) if okrows else None,
        "apr_min_pct": round(min(r["apr_pct"] for r in okrows), 2) if okrows else None,
        "apr_max_pct": round(max(r["apr_pct"] for r in okrows), 2) if okrows else None,
        "rows": rows,
    }
    if okrows:
        m = results[c]
        print(f"  ⇒ {c}: APR median={m['apr_median_pct']}% range=[{m['apr_min_pct']}%,{m['apr_max_pct']}%] "
              f"paid {m['with_payments']}/{m['sampled']}")

# ── D) summary ────────────────────────────────────────────────────────────────
section("D) summary")
all_aprs = [r["apr_pct"] for c in results for r in results[c]["rows"] if r["apr_pct"] is not None]
out = {"measured_at": datetime.datetime.now().isoformat(),
       "head_block": dgp["head_block_number"], "vest2sp": VEST2SP,
       "ask_sbd_per_steem": ASK, "intermediaries": results}
if all_aprs:
    out["global_apr_median_pct"] = round(statistics.median(all_aprs), 2)
    print(f"GLOBAL APR median over {len(all_aprs)} paid samples: {out['global_apr_median_pct']}%")
    for c in results:
        m = results[c]
        print(f"  {c:<14} median {str(m['apr_median_pct']):>7}%  "
              f"delegators_seen={m['discovered_delegators']:>4}  paid={m['with_payments']}/{m['sampled']}  "
              f"claim_account_ops={m['context'].get('claim_account_ops', 0)}")
    # headcorner income projection at own SP
    own = 5320.0
    for c in results:
        m = results[c]
        if m["apr_median_pct"]:
            print(f"  projection: headcorner renting {own:,.0f} SP to {c} @median → "
                  f"{own * m['apr_median_pct'] / 100:.1f} STEEM/yr ≈ {own * m['apr_median_pct'] / 100 / 12 * (ASK or 0) * 1:.2f} SBD/mo")
else:
    print("No rental payments observed in sampled windows.")

os.makedirs(".zscripts", exist_ok=True)
with open(".zscripts/rental_scan_results.json", "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print("\nsaved → .zscripts/rental_scan_results.json")
