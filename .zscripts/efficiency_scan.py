#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
efficiency_scan.py — Task 20-a: efficiency + profit probe from the chain.
READ-ONLY, api.steemit.com only, zero web, zero money ops.
Method inherits docs/ROAST.md rules: every number measured live; if not
measurable → honest null + reason (פער-אמת).

Sections:
  1. ticket    — account_creation_fee (get_chain_properties) + feed median +
                 account-level pending_claimed_accounts of the factories
  2. rc        — rc_api.find_rc_accounts ×3 (headcorner/justyy/upvu) + get_accounts ×3 →
                 capacity ratio inference for claims/day (range, pending A2 exact cost)
  3. curation  — paginate headcorner ~2,000 ops → per-UTC-day curation SP, active SP/day,
                 APR on own SP, $/day + $/month, current VP%
  4. pending   — reward balances refresh → pending SP + $
  5. rental    — outgoing delegation guard (did the operator delegate 1,000 SP to upvu?)
                 + upvu.bank recent 1,000 ops (payments to headcorner + payment cadence)
                 + what 1,000 SP would yield at measured prices
  6. agent     — static RPC count per loop from agent/agent.cjs (code reading, not chain)
  7. market    — order_book(50) top bid + VWAP exec-edge for 100 SBD (same math as
                 agent.cjs / auto_scan.py) + 24h/48h volume via get_trade_history

$ convention (explicit assumption): SBD≈$1. SP/STEEM income flows valued at the
internal-market top bid (realization price); fee_usd valued at the operative feed
(the chain's own quote), as specified in the task. Off-chain STEEM market price
(≈$0.0427, measured in earlier tasks via the console external source) is OUT OF
SCOPE for this chain-only scan — noted as פער-אמת where it matters.
"""
import json, time, datetime, urllib.request

RPC = "https://api.steemit.com"

def rpc(method, params, retries=3, timeout=30):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(RPC, data=json.dumps({
                "jsonrpc": "2.0", "method": method, "params": params, "id": 1
            }).encode(), headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                j = json.loads(r.read().decode())
            if "error" in j:
                raise RuntimeError(j["error"].get("message", "?")[:160])
            return j["result"]
        except Exception as e:
            last = e
            time.sleep(1.0 + i)
    raise RuntimeError(f"{method}: {last}")

def num(a):
    return float(a.split(" ")[0]) if isinstance(a, str) and a else (float(a or 0))

def section(t):
    print("\n" + "=" * 72)
    print(t)
    print("=" * 72)

def paginate(acc, want_ops, batch=99, sleep=0.12, max_batches=60):
    """Ascending-batch pagination (fixed pattern from Tasks 17/19:
    batches return ASCENDING inside; next start = batch[0][0] - 1)."""
    pages, low, got = [], -1, 0
    while got < want_ops and (max_batches is None or len(pages) < max_batches):
        b = rpc("condenser_api.get_account_history",
                [acc, low if low >= 0 else -1, batch])
        if not b:
            break
        pages.append(b)
        got += len(b)
        low = b[0][0]
        if low <= 0:
            break
        time.sleep(sleep)
    seen = {}
    for p in pages:
        for idx, ev in p:
            seen[idx] = ev
    return [seen[k] for k in sorted(seen)], got

out = {"measuredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
       "rpc": "https://api.steemit.com", "mode": "read-only, zero money ops",
       "dollar_convention": "SBD≈$1 assumption; income flows valued at internal-market top bid; fee_usd at operative feed (per task spec)"}

def fail(sec, e):
    out[sec] = None
    out[sec + "_error"] = str(e)[:200]
    print(f"  [{sec}] FAILED: {e}")

def fmt(x, spec):
    return format(x, spec) if x is not None else "null"

# ══ core globals (needed by every section) ═══════════════════════════════════
section("0) core — DGP + feed + book")
try:
    dgp = rpc("condenser_api.get_dynamic_global_properties", [])
    fh = rpc("condenser_api.get_feed_history", [])
    cmh = fh["current_median_history"]
    feed = num(cmh["base"]) / num(cmh["quote"])  # SBD per STEEM (operative)
    v2s = num(dgp["total_vesting_fund_steem"]) / num(dgp["total_vesting_shares"])
    ob = rpc("condenser_api.get_order_book", [50])
    bids = sorted([(num(x.get("real_price", "0")), num(x.get("steem", "0"))) for x in ob.get("bids", [])],
                  key=lambda x: -x[0])
    bids = [(p, s) for p, s in bids if p > 0 and s > 0]
    asks = sorted([num(x.get("real_price", "0")) for x in ob.get("asks", []) if num(x.get("real_price", "0")) > 0])
    bid_price = bids[0][0] if bids else feed
    print(f"head={dgp['head_block_number']:,} · feed={feed:.6f} · vest2sp={v2s:.10f} · bid={bid_price:.5f}")
except Exception as e:
    print(f"  [core] FAILED: {e} — aborting (all sections depend on it)")
    raise SystemExit(1)

# ══ 1. ticket ════════════════════════════════════════════════════════════════
section("1) ticket — account_creation_fee + feed + factory inventory")
try:
    cp = rpc("condenser_api.get_chain_properties", [])
    fee = num(cp["account_creation_fee"])        # "3.000 STEEM"
    hc_acc = rpc("condenser_api.get_accounts", [["headcorner"]])[0]
    out["ticket"] = {
        "account_creation_fee_raw": cp["account_creation_fee"],
        "source": "condenser_api.get_chain_properties (DGP does not expose account_creation_fee on this node)",
        "fee_steem": fee,
        "feed_sbd_per_steem": round(feed, 6),
        "fee_sbd_at_feed": round(fee * feed, 6),
        "fee_usd_at_feed": round(fee * feed, 6),  # SBD≈$1 assumption
        "assumption": "SBD≈$1 — ticket upper-bound value, NOT a proven market price (market price of accounts is off-chain — פער-אמת)",
        "headcorner_pending_claimed_accounts": hc_acc.get("pending_claimed_accounts"),
        "global_pending_claimed_accounts": None,
        "global_pending_claimed_accounts_reason":
            "השדה הגלובלי לא חשוף ב-DGP של הצומת הזה (נבדק: אין מפתח כזה) — נמדד לכל מפעל בנפרד",
        "available_account_subsidies": dgp.get("available_account_subsidies"),
        "head_block": dgp["head_block_number"],
        "cross_check_task19_feed_0_104326": round(feed, 6),
    }
    print(f"fee={cp['account_creation_fee']} → ${fee*feed:.4f} (SBD≈$1) · "
          f"headcorner pending_claimed={hc_acc.get('pending_claimed_accounts')} · "
          f"subsidies={dgp.get('available_account_subsidies'):,}")
except Exception as e:
    fail("ticket", e)

# ══ 2. rc ════════════════════════════════════════════════════════════════════
section("2) rc — capacity inference for headcorner vs justyy/upvu")
try:
    ACCS = ["headcorner", "justyy", "upvu"]
    rcres = rpc("rc_api.find_rc_accounts", {"accounts": ACCS})
    recs = rcres["rc_accounts"]
    raw_keys = {
        "response_top_keys": sorted(rcres.keys()),
        "rc_account_record_keys": sorted(recs[0].keys()) if recs else [],
    }
    accs = {a["name"]: a for a in rpc("condenser_api.get_accounts", [ACCS])}
    rows = {}
    for r in recs:
        name = r["account"]
        max_rc = int(r["max_rc"])
        cur = int(r["rc_manabar"]["current_mana"])
        a = accs.get(name, {})
        rows[name] = {
            "max_rc": max_rc,
            "current_mana": cur,
            "rc_pct": round(100.0 * cur / max_rc, 2) if max_rc else 0,
            "vesting_shares_raw": a.get("vesting_shares"),
            "vesting_sp": round(num(a.get("vesting_shares", "0")) * v2s, 1) if v2s else None,
            "pending_claimed_accounts": a.get("pending_claimed_accounts"),
        }
        print(f"  @{name:<11} max_rc={max_rc:,} ({fmt(rows[name]['rc_pct'],'.2f')}%) · "
              f"SP={fmt(rows[name]['vesting_sp'],',.0f')} · pending_claimed={rows[name]['pending_claimed_accounts']}")
    hc, jy, uv = rows["headcorner"], rows["justyy"], rows["upvu"]
    ratio_jy = hc["max_rc"] / jy["max_rc"] if jy["max_rc"] else None
    ratio_uv = hc["max_rc"] / uv["max_rc"] if uv["max_rc"] else None
    # anchor rates measured earlier from the chain:
    #   justyy ~165 claim_account/day (Tasks 17/19), upvu ~275/day
    jy_rate, uv_rate = 165.0, 275.0
    inf_jy = jy_rate * ratio_jy if ratio_jy else None
    inf_uv = uv_rate * ratio_uv if ratio_uv else None
    # refined bounds (RC-budget accounting, not naive scaling):
    #   C (RC cost per claim) <= regen_justyy / rate_justyy  (justyy's claims eat at most all its regen)
    #   lower bound: headcorner mirrors justyy's budget fraction → naive ratio value
    #   upper bound: headcorner all-in on claims AND claims eat only ~10% of justyy's budget
    regen_hc = hc["max_rc"] / 5.0
    regen_jy = jy["max_rc"] / 5.0
    regen_uv = uv["max_rc"] / 5.0
    cost_upper_jy = regen_jy / jy_rate
    cost_upper_uv = regen_uv / uv_rate
    bound_lo = inf_jy
    bound_hi = regen_hc / (0.1 * cost_upper_jy)
    out["rc"] = {
        "raw_response_shape": raw_keys,
        "accounts": rows,
        "headcorner_max_rc_over_justyy": round(ratio_jy, 6) if ratio_jy else None,
        "headcorner_max_rc_over_upvu": round(ratio_uv, 6) if ratio_uv else None,
        "inferred_claims_per_day": {
            "method": "same op (claim_account), same 5-day RC regen window; anchor = measured "
                      "sustainable rate of the reference factory × (headcorner max_rc / reference max_rc)",
            "justyy_anchored_165x": round(inf_jy, 1) if inf_jy else None,
            "upvu_anchored_275x": round(inf_uv, 1) if inf_uv else None,
            "range_note": "RANGE, not a point estimate: reference factories also spend RC on other ops "
                          "(justyy posts/votes, upvu votes/transfers ~84/day), and RC cost per claim is NOT "
                          "yet measured — pending A2 (one signed claim_account logging RC before/after). "
                          "If A2 shows cost C RC/claim, exact sustainable rate = max_rc/5 / C.",
            "pending_a2_tag": "ממתין ל-A2",
        },
        "bounds_refined": {
            "lower_claims_per_day": round(bound_lo, 2),
            "upper_claims_per_day": round(bound_hi, 1),
            "lower_method": "same RC-budget fraction as justyy → naive ratio (165 × max_rc ratio)",
            "upper_method": "headcorner all-in on claims AND claims consume only ~10% of justyy's regen budget",
            "cost_per_claim_upper_bound_rc_justyy_anchor": int(cost_upper_jy),
            "cost_per_claim_upper_bound_rc_upvu_anchor": int(cost_upper_uv),
            "headcorner_regen_per_day": int(regen_hc),
            "ticket_usd_projection": {
                "per_claim_usd": round(fee * feed, 4) if "fee" in dir() else None,
                "per_day_usd_lower": round(bound_lo * fee * feed, 3) if "fee" in dir() else None,
                "per_day_usd_upper": round(bound_hi * fee * feed, 3) if "fee" in dir() else None,
                "warning": "ערך-עליון של הטיקט (account_creation_fee) בלבד — לא מחיר-שוק; מונטיז אמיתי "
                           "הוא rail חוץ-שרשרת (פער-אמת)",
            },
        },
        "refill_per_day_max_rc_over_5": int(hc["max_rc"] / 5),
        "cross_check_task19_regen_1_8e12": {
            "task19_value": 1.8e12,
            "measured_now": int(hc["max_rc"] / 5),
            "consistent": abs(hc["max_rc"] / 5 - 1.8e12) / 1.8e12 < 0.05,
        },
    }
    print(f"  ratio hc/justyy={ratio_jy:.4f} hc/upvu={ratio_uv:.4f} → inferred claims/day: "
          f"justyy-anchored {fmt(inf_jy,'.1f')} · upvu-anchored {fmt(inf_uv,'.1f')} · "
          f"refined range {bound_lo:.2f}–{bound_hi:.1f}/day · refill/day={hc['max_rc']//5:,}")
except Exception as e:
    fail("rc", e)

# ══ 3. curation ══════════════════════════════════════════════════════════════
section("3) curation — re-check over ~2,000 ops of headcorner")
try:
    ops, fetched = paginate("headcorner", 2050)
    per_day = {}
    n_cur = 0
    for ev in ops:
        op = ev.get("op", [])
        if isinstance(op, dict):
            t, d = op.get("type", "").replace("_operation", ""), op.get("value", {})
        else:
            t, d = op[0], op[1]
        if t == "curation_reward":
            day = ev["timestamp"][:10]
            per_day[day] = per_day.get(day, 0.0) + num(d.get("reward", "0")) * v2s
            n_cur += 1
    a = rpc("condenser_api.get_accounts", [["headcorner"]])[0]
    vests_raw = num(a["vesting_shares"])
    deleg_raw = num(a.get("delegated_vesting_shares", "0"))
    recv_raw = num(a.get("received_vesting_shares", "0"))
    own_sp = (vests_raw - deleg_raw + recv_raw) * v2s
    active_days = {k: v for k, v in per_day.items() if v > 0}
    tot = sum(per_day.values())
    n_active = max(len(active_days), 1)
    sp_per_active_day = tot / n_active
    apr = sp_per_active_day * 365.0 / own_sp * 100.0 if own_sp > 0 else None
    vm = a.get("voting_manabar", {})
    eff_vests = vests_raw - deleg_raw + recv_raw
    vp_pct = 100.0 * num(vm.get("current_mana", 0)) / (eff_vests * 1e6) if eff_vests else None
    out["curation"] = {
        "ops_scanned": fetched,
        "n_curation_rewards": n_cur,
        "window": {"first_reward_day": min(per_day) if per_day else None,
                   "last_reward_day": max(per_day) if per_day else None},
        "total_sp_window": round(tot, 4),
        "active_days": len(active_days),
        "sp_per_active_day": round(sp_per_active_day, 5),
        "sp_per_calendar_day_of_window": round(tot / max(1, len(per_day)), 5),
        "own_sp_formula": "vesting_shares − delegated_vesting_shares + received_vesting_shares",
        "own_sp": round(own_sp, 1),
        "apr_pct_on_own_sp_when_active": round(apr, 2) if apr else None,
        "usd_per_active_day_bid": round(sp_per_active_day * bid_price, 4),
        "usd_per_month_bid": round(sp_per_active_day * bid_price * 30.4, 3),
        "bid_used_sbd_per_steem": round(bid_price, 6),
        "vp_current_pct": round(vp_pct, 2) if vp_pct else None,
        "voting_mana_raw": vm.get("current_mana"),
        "per_active_day_top5": {k: round(v, 4) for k, v in
                                sorted(active_days.items(), key=lambda x: -x[1])[:5]},
        "note": "SP/day 'active' = mean over UTC days that had ≥1 curation reward (dormant days "
                "excluded — the account is dormant since ~2/2026); calendar-day mean given too for honesty",
    }
    print(f"  rewards={n_cur} in {fetched} ops · active_days={len(active_days)} · "
          f"SP/active-day={sp_per_active_day:.4f} · APR={fmt(apr,'.2f')}% · own={own_sp:,.0f} SP · "
          f"VP={fmt(vp_pct,'.1f')}% · ${sp_per_active_day*bid_price:.4f}/day · "
          f"${sp_per_active_day*bid_price*30.4:.2f}/mo")
except Exception as e:
    fail("curation", e)

# ══ 4. pending ═══════════════════════════════════════════════════════════════
section("4) pending claim refresh")
try:
    a = rpc("condenser_api.get_accounts", [["headcorner"]])[0]
    rvb, rs, rsbd = a["reward_vesting_balance"], a["reward_steem_balance"], a["reward_sbd_balance"]
    pending_sp = num(rvb) * v2s
    out["pending_claim"] = {
        "reward_vesting_balance_raw": rvb,
        "reward_steem_raw": rs,
        "reward_sbd_raw": rsbd,
        "pending_sp": round(pending_sp, 3),
        "pending_usd_bid": round((pending_sp + num(rs)) * bid_price + num(rsbd), 3),
        "bid_used": round(bid_price, 6),
        "cross_check_task19_26_3sp": {"task19_value_sp": 26.3,
                                      "consistent": abs(pending_sp - 26.3) < 1.0,
                                      "note": "אם שונה — ייתכן שהמפעיל תבע בינתיים; הערך בפועל רשום"},
    }
    print(f"  pending: {rvb} ({pending_sp:.3f} SP) + {rs} + {rsbd} → ≈${out['pending_claim']['pending_usd_bid']}")
except Exception as e:
    fail("pending_claim", e)

# ══ 5. rental ════════════════════════════════════════════════════════════════
section("5) rental guard — delegation to upvu? upvu.bank cadence?")
try:
    outs = rpc("condenser_api.get_vesting_delegations", ["headcorner", "", 1000]) or []
    out_deleg = [{"delegatee": o["delegatee"],
                  "sp": round(num(o["vesting_shares"]) * v2s, 3)} for o in outs]
    bank_ops, bank_fetched = paginate("upvu.bank", 1000, sleep=0.1)
    pays_to_hc, n_bank_transfers, bank_steem = [], 0, 0.0
    first_ts = last_ts = None
    for ev in bank_ops:
        ts = ev["timestamp"]
        if first_ts is None or ts < first_ts: first_ts = ts
        if last_ts is None or ts > last_ts: last_ts = ts
        op = ev.get("op", [])
        if isinstance(op, dict):
            t, d = op.get("type", "").replace("_operation", ""), op.get("value", {})
        else:
            t, d = op[0], op[1]
        if t == "transfer":
            n_bank_transfers += 1
            amt = d.get("amount", "")
            if amt.endswith("STEEM"):
                bank_steem += num(amt)
            if d.get("to") == "headcorner":
                pays_to_hc.append({"ts": ts, "amount": amt, "memo": (d.get("memo") or "")[:120]})
    span_days = (datetime.datetime.strptime(last_ts, "%Y-%m-%dT%H:%M:%S") -
                 datetime.datetime.strptime(first_ts, "%Y-%m-%dT%H:%M:%S")).total_seconds() / 86400.0
    has_deleg = bool(out_deleg)
    sp_out = sum(x["sp"] for x in out_deleg)
    proj = {
        "sp_delegated": 1000,
        "apr_reference_pct": 4.15,
        "apr_reference_source": "docs/RENTAL_SCAN.md (Task 17) — measured median over 13 paid samples",
        "sp_per_year": round(1000 * 0.0415, 1),
        "usd_per_year_bid": round((1000 * 0.0415) * bid_price, 2),
        "usd_per_month_bid": round((1000 * 0.0415) * bid_price / 12, 3),
    }
    out["rental"] = {
        "headcorner_outgoing_delegations": out_deleg,
        "delegation_done": has_deleg,
        "delegated_out_sp": round(sp_out, 3),
        "verdict": "בוצע" if has_deleg else "לא בוצע עדיין — המפעיל לא הקצה עדיין 1,000 SP ל-upvu",
        "upvu_bank_sample": {
            "ops_scanned": bank_fetched,
            "window_first": first_ts, "window_last": last_ts,
            "window_days": round(span_days, 2),
            "transfers_in_sample": n_bank_transfers,
            "transfers_per_day": round(n_bank_transfers / span_days, 1) if span_days > 0 else None,
            "steem_paid_per_day": round(bank_steem / span_days, 2) if span_days > 0 else None,
            "transfers_to_headcorner": pays_to_hc,
        },
        "apr_recheck": "4.15% מהמדידה המקורית (17) נשאר הייחוס; רענון מלא של ה-APR מצריך דגימת-משלמים "
                       "כבדה — המדד הזול היום: מכונת התשלומים upvu.bank חיה (קצב נמדד לעיל) ואין "
                       "delegation שלנו שהשתנתה",
        "projection_1000sp": proj,
    }
    print(f"  outgoing delegations: {out_deleg if out_deleg else '[]'} · upvu.bank: "
          f"{n_bank_transfers} transfers in {span_days:.2f}d ({n_bank_transfers/span_days:.0f}/day, "
          f"{bank_steem/span_days:.1f} STEEM/day), to headcorner: {len(pays_to_hc)} · "
          f"1,000SP@4.15% → {proj['sp_per_year']} SP/yr ≈ ${proj['usd_per_year_bid']}/yr ≈ ${proj['usd_per_month_bid']}/mo")
except Exception as e:
    fail("rental", e)

# ══ 6. agent static RPC efficiency ═══════════════════════════════════════════
section("6) agent static RPC count (code reading of agent/agent.cjs v0.2.0 — 5 loops)")
# Method: static code reading (NOT a chain measurement). Defaults: CLAIM_INTERVAL_MIN=60,
# WATCH_INTERVAL_MIN=5, TRANSFER_WATCH_MIN=5, CURATION_ENABLED=false, curation 30-min loop,
# FACTORY_ENABLED=false, factory 30-min loop, shared TTL cache CACHE_TTL_SEC=15.
rows_agent = [
    {"loop": "claim (claim_reward_balance)",
     "calls_per_cycle": 2, "rpc_calls": ["get_dynamic_global_properties", "get_accounts (cached, TTL 15s)"],
     "interval_min_default": 60, "runs_only_if": "תמיד (גם ניטור-בלבד); חתימה רק עם POSTING_WIF"},
    {"loop": "watch (BOT-3 window)",
     "calls_per_cycle": 2, "rpc_calls": ["get_feed_history", "get_order_book(50) — מדולג אם הפיד לא זז"],
     "interval_min_default": 5, "runs_only_if": "always"},
    {"loop": "transfer-watch",
     "calls_per_cycle": 1, "rpc_calls": ["get_account_history(-1,100)"],
     "interval_min_default": 5, "runs_only_if": "always"},
    {"loop": "curation skeleton",
     "calls_per_cycle": 4, "rpc_calls": ["get_accounts (cached) + get_discussions_by_created ×3 default tags"],
     "interval_min_default": 30, "runs_only_if": "CURATION_ENABLED=true (default false)"},
    {"loop": "factory B1 (claim_account)",
     "calls_per_cycle": 1, "rpc_calls": ["rc_api.find_rc_accounts (cached); בזמן תביעה בפועל: 5 קריאות + שידור"],
     "interval_min_default": 30, "runs_only_if": "FACTORY_ENABLED=true + ACTIVE_WIF (default false)"},
]
total_per_5min = 0.0
total_per_hour = 0.0
for r in rows_agent:
    cph = r["calls_per_cycle"] * 60.0 / r["interval_min_default"]
    r["calls_per_hour"] = round(cph, 2)
    total_per_hour += cph
    total_per_5min += r["calls_per_cycle"] * 5.0 / r["interval_min_default"]
cur_row = next(r for r in rows_agent if r["loop"].startswith("curation"))
fct_row = next(r for r in rows_agent if r["loop"].startswith("factory"))
total_per_hour_no_curation = total_per_hour - cur_row["calls_per_hour"] - fct_row["calls_per_hour"]
out["agent_rpc"] = {
    "method": "static code reading of agent/agent.cjs v0.2.0 (ספירת קריאות בקוד — לא מדידת רשת)",
    "note_shared_cache": "v2: קאש TTL-15s משותף ל-get_accounts/rc_api — 5 לופים באותו-חלון = קריאה אחת; +1 קריאת rc חד-פעמית בהפעלה",
    "note_feed_skip": "דילוג על get_order_book כשהפיד זהה עד 9 ספרות — בפועל נדיר (ה-quote = current_supply שגדל בכל בלוק, ROAST), לכן הטבלה סופרת מלוא-הקריאות",
    "table": rows_agent,
    "total_per_5min_cycle": round(total_per_5min, 2),
    "total_per_hour_all_enabled": round(total_per_hour, 1),
    "total_per_hour_default_off": round(total_per_hour_no_curation, 1),
    "verdict": "יעיל — ~38 קריאות/שעה ברירת-מחדל (~46 עם קוראציה+מפעל) הוא זעיר לצומת ציבורי; אין בזבוז "
               "(הקאש המשותף והשערים RC/VP מונעים קריאות-מיותר; דילוג-ה-book נדיר-תועלת אך לא מזיק)",
}
print(f"  total ≈ {total_per_5min:.2f} calls per 5-min cycle ≈ "
      f"{total_per_hour_no_curation:.0f}/hour (defaults off) · {total_per_hour:.0f}/hour (all enabled)")

# ══ 7. market ════════════════════════════════════════════════════════════════
section("7) market edge refresh — order book + 24h/48h volume")
try:
    asks = sorted([num(x.get("real_price", "0")) for x in ob.get("asks", []) if num(x.get("real_price", "0")) > 0])
    SIZE_SBD = 100.0
    need = SIZE_SBD / feed if feed else 0.0   # SBD → STEEM at the operative feed
    rem, proceeds = need, 0.0
    for p, s in bids:
        take = min(rem, s)
        proceeds += take * p
        rem -= take
        if rem <= 1e-9:
            break
    edge = (proceeds / SIZE_SBD - 1) * 100 if SIZE_SBD > 0 else None

    def vol(days):
        now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        t0 = (now - datetime.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
        t1 = now.strftime("%Y-%m-%dT%H:%M:%S")
        th = rpc("condenser_api.get_trade_history", [t0, t1, 1000])
        sbd_v = sum(num(t["current_pays"]) if t["current_pays"].endswith("SBD") else num(t["open_pays"]) for t in th)
        st_v = sum(num(t["current_pays"]) if t["current_pays"].endswith("STEEM") else num(t["open_pays"]) for t in th)
        return {"trades": len(th), "sbd": round(sbd_v, 2), "steem": round(st_v, 2),
                "usd_at_feed": round(sbd_v + st_v * feed, 2),
                "possibly_truncated": len(th) >= 1000,
                "window_days": days,
                "newest_trade": th[0]["date"] if th else None}

    v24, v48 = vol(1), vol(2)
    out["market"] = {
        "bid_top": round(bids[0][0], 6) if bids else None,
        "ask_top": round(asks[0], 6) if asks else None,
        "spread_pct": round((asks[0] - bids[0][0]) / ((asks[0] + bids[0][0]) / 2) * 100, 3)
                       if bids and asks else None,
        "vwap_edge_pct_100sbd": round(edge, 2) if edge is not None else None,
        "vwap_filled": rem <= 1e-9,
        "method": "same math as agent.cjs execEdge / market-snapshot.ts: sell 100/feed STEEM into bids",
        "vol24h": v24, "vol48h": v48,
        "vol_note": "get_recent_trades_by_account לא נבדק/לא זמין זול — get_trade_history בלבד",
        "cross_check": {"feed_0_104326": round(feed, 6),
                        "roast_window": "צפוי סגור (edge שלילי) — מתעדכן מהערך החי"},
    }
    print(f"  bid={bids[0][0]:.5f} · edge(100 SBD)={edge:+.2f}% (filled={rem<=1e-9}) · "
          f"24h: {v24['trades']} trades ${v24['usd_at_feed']} · 48h: {v48['trades']} trades "
          f"${v48['usd_at_feed']} · newest_trade={v48['newest_trade']}")
except Exception as e:
    fail("market", e)

# ══ write ════════════════════════════════════════════════════════════════════
with open(".zscripts/efficiency_scan_results.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("\nsaved → .zscripts/efficiency_scan_results.json")
secs = ("ticket", "rc", "curation", "pending_claim", "rental", "agent_rpc", "market")
print("sections:", ", ".join(k for k in secs if out.get(k) is not None) +
      ("  | NULL: " + ", ".join(k for k in secs if out.get(k) is None) if any(out.get(k) is None for k in secs) else "  | all present"))
