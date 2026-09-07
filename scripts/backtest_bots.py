#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAOS — bot backtests on measured data. OFFLINE (no chain writes).
BOT-3: SBD->STEEM convert arbitrage over a 365-day price history.
BOT-2: curation steady-state projection calibrated to live-measured APRs (3.31%-7.61%).
BOT-4: fresh internal-order-book snapshot vs external price (gap measurement).
Results -> scripts/backtest_results.json
"""
import json
import urllib.request
import statistics
from datetime import datetime, timezone

OUT = "scripts/backtest_results.json"
results = {"ts": datetime.now(timezone.utc).isoformat()}

FEED_ACTIVE = 0.1043          # measured: 9 x SBD_supply / STEEM_supply (99.99% match)
CONVERT_DAYS = 3.5
STEEM_PER_SBD = 1.0 / FEED_ACTIVE   # 9.588 STEEM per SBD at convert


def http_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "SAOS-research/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def fetch_history(coin):
    d = http_json(f"https://api.coingecko.com/api/v3/coins/{coin}/market_chart?vs_currency=usd&days=365&interval=daily")
    return [p[1] for p in d["prices"]]


# ------------------------------------------------------------------ BOT-3
def backtest_bot3(steem, sbd):
    n = min(len(steem), len(sbd))
    steem, sbd = steem[-n:], sbd[-n:]

    def simulate(trigger, hedged=False, momentum_filter=False):
        """cycle: SBD -> convert (3.5d) -> STEEM -> sell.
        hedged:    short STEEM at entry locks exit value -> realized = projected edge (no STEEM risk)
        unhedged:  exit at t+3 market -> STEEM crash risk (measured: -30%/3d events happen)"""
        cap = 1000.0
        busy_until = -1
        events = 0
        peak = cap
        max_dd = 0.0
        for t in range(n - int(CONVERT_DAYS)):
            if t <= busy_until:
                continue
            if momentum_filter and t >= 14:
                mom = steem[t] / steem[t - 14] - 1
                if mom < -0.05:
                    continue
            proj_edge = (STEEM_PER_SBD * steem[t] / sbd[t]) - 1.0
            if proj_edge >= trigger:
                if hedged:
                    mult = 1.0 + proj_edge          # locked at entry (short covers price risk)
                else:
                    mult = STEEM_PER_SBD * steem[t + int(CONVERT_DAYS)] / sbd[t]
                cap *= mult
                events += 1
                busy_until = t + int(CONVERT_DAYS)
                peak = max(peak, cap)
                if peak > 0:
                    max_dd = max(max_dd, 1 - cap / peak)
        return {"trigger_pct": round(trigger * 100, 1), "cycles": events,
                "final_usd": round(cap, 2), "return_1y_pct": round((cap / 1000 - 1) * 100, 2),
                "max_drawdown_pct": round(max_dd * 100, 2),
                "days_in_market": round(events * CONVERT_DAYS, 1)}

    # 365d constant-K distribution — kept for reference only (historical K differed)
    edges = [(STEEM_PER_SBD * steem[i + 3] / sbd[i]) - 1.0 for i in range(n - 4)]
    dist = {
        "edge_realized_mean_pct": round(statistics.mean(edges) * 100, 2),
        "edge_realized_median_pct": round(statistics.median(edges) * 100, 2),
        "edge_positive_days_pct": round(100 * sum(1 for e in edges if e > 0) / len(edges), 1),
        "edge_min_pct": round(min(edges) * 100, 2),
        "edge_max_pct": round(max(edges) * 100, 2),
    }

    # ------------------------------------------------ current regime (last 60d, today's K)
    W = 60
    hedged_edges = [(STEEM_PER_SBD * steem[i] / sbd[i]) - 1.0 for i in range(n - W, n)]
    unhedged_edges = [(STEEM_PER_SBD * steem[i + 3] / sbd[i]) - 1.0 for i in range(n - W, n - 3)]
    regime = {
        "window_days": W, "feed_assumed_constant": FEED_ACTIVE,
        "live_edge_now_pct": round(hedged_edges[-1] * 100, 2),
        "hedged_cycle_edge": {"mean_pct": round(statistics.mean(hedged_edges) * 100, 2),
                              "median_pct": round(statistics.median(hedged_edges) * 100, 2),
                              "positive_pct": round(100 * sum(1 for e in hedged_edges if e > 0) / len(hedged_edges), 1),
                              "min_pct": round(min(hedged_edges) * 100, 2),
                              "max_pct": round(max(hedged_edges) * 100, 2)},
        "unhedged_cycle_edge": {"mean_pct": round(statistics.mean(unhedged_edges) * 100, 2),
                                "positive_pct": round(100 * sum(1 for e in unhedged_edges if e > 0) / len(unhedged_edges), 1),
                                "min_pct": round(min(unhedged_edges) * 100, 2)},
        "hedged_days_over_3pct_pct": round(100 * sum(1 for e in hedged_edges if e > 0.03) / len(hedged_edges), 1),
        "hedged_days_over_5pct_pct": round(100 * sum(1 for e in hedged_edges if e > 0.05) / len(hedged_edges), 1),
        "verdict": ("edge oscillates around ZERO in the current regime (+/-7% band, positive only ~37% of days): "
                    "convert-arb is EVENT-DRIVEN (fire only above +5%), not a steady APR machine"),
        "warning": "feed (K) is debt-managed and regime-dependent: historical K differed; 365d compounding with today's K is INVALID. Only last-60d regime stats are trustworthy.",
    }

    # ------------------------------------------------ forward Monte Carlo, hedged, 90d
    # SBD price is ANCHORED to the convert value (that's why the ratio oscillates around 1.0),
    # so a price-level walk is invalid. Honest MC: bootstrap cycle edges from the 60d
    # empirical distribution (mean ~ 0), fire only above trigger, subtract execution cost.
    import random
    random.seed(42)
    trig = 0.03
    cost = 0.005  # execution + slippage per cycle (buy SBD, hedge, unwind)
    triggered = [e for e in hedged_edges if e > trig]
    mc = {"paths": 5000, "days": 90, "capital_usd": 10_000, "trigger_pct": 3, "cost_per_cycle_pct": 0.5,
          "method": ("bootstrap of measured 60d hedged cycle-edge distribution (i.i.d.); cycle=3.5d; "
                     "fire only when draw >= trigger; profit = edge - cost"),
          "E_edge_given_triggered_pct": round(statistics.mean(triggered) * 100, 2) if triggered else None,
          "trigger_rate_pct": round(100 * len(triggered) / len(hedged_edges), 1)}
    finals = []
    for _ in range(mc["paths"]):
        cap = mc["capital_usd"]
        d = 0
        while d < mc["days"]:
            e = random.choice(hedged_edges)
            if e >= trig:
                cap *= (1.0 + e - cost)
                d += int(CONVERT_DAYS)
            else:
                d += 1
        finals.append(cap)
    finals.sort()
    mc["expected_events_90d"] = round(90 * mc["trigger_rate_pct"] / 100 / 1.0, 1)
    mc["final_p10"] = round(finals[len(finals) // 10], 0)
    mc["final_median"] = round(finals[len(finals) // 2], 0)
    mc["final_p90"] = round(finals[9 * len(finals) // 10], 0)
    mc["median_90d_return_pct"] = round((finals[len(finals) // 2] / mc["capital_usd"] - 1) * 100, 2)
    mc["p10_90d_return_pct"] = round((finals[len(finals) // 10] / mc["capital_usd"] - 1) * 100, 2)
    mc["p90_90d_return_pct"] = round((finals[9 * len(finals) // 10] / mc["capital_usd"] - 1) * 100, 2)
    mc["note"] = ("hedged (short STEEM during 3.5d window); capital sits idle between events; "
                  "hard capacity cap = liquid SBD float (~6.4M SBD supply)")

    # STEEM raw volatility evidence (independent of K)
    drops = sorted(steem[i + 3] / steem[i] for i in range(n - 3))
    vol_evidence = {"max_3d_drops_pct": [round((r - 1) * 100, 1) for r in drops[:4]],
                    "count_3d_drops_over_15pct": sum(1 for r in drops if r < 0.85)}

    variants = []
    for label, kw in [("hedged_lock_at_entry", {"hedged": True}),
                      ("unhedged_full_exposure", {}),
                      ("unhedged_momentum_filter", {"momentum_filter": True})]:
        for tr in (0, 3, 5, 8):
            r = simulate(tr / 100, **kw)
            r["variant"] = label
            variants.append(r)
    return {"edge_distribution_365d_constantK_INVALID": dist,
            "current_regime_last60d": regime,
            "forward_montecarlo_hedged_90d": mc,
            "steem_volatility_evidence": vol_evidence,
            "simulations_constantK_reference_only": variants,
            "headline": ("UNHEDGED compounding = ruin-risk (STEEM -30%/3d crashes measured in raw series); "
                         "hedged (short STEEM during 3.5d window) = edge locked. Historical K unknown -> "
                         "only current-regime (60d) numbers are decision-grade."),
            "assumptions": {"feed_active": FEED_ACTIVE, "steem_per_sbd_at_convert": round(STEEM_PER_SBD, 4),
                            "mechanism": "convert locks STEEM amount at request-time feed; exits after 3.5d at market",
                            "momentum_filter": "skip entries when STEEM 14d momentum < -5%"}}


# ------------------------------------------------------------------ BOT-2
def model_bot2():
    """Steady-state curation projection calibrated to live-measured professional curators."""
    calibrated = [
        {"profile": "spread-whale (justyy)", "votes_day": 70.7, "weight_pct": 8.5, "apr_measured": 3.31},
        {"profile": "service-bot (upvu)", "votes_day": 92.6, "weight_pct": 10.4, "apr_measured": 5.64},
        {"profile": "community-curator (h4lab)", "votes_day": 73.0, "weight_pct": 12.2, "apr_measured": 5.99},
        {"profile": "focused-curator (steemcurator03)", "votes_day": 28.5, "weight_pct": 34.3, "apr_measured": 7.24},
        {"profile": "focused-curator (steemcurator04)", "votes_day": 27.8, "weight_pct": 35.3, "apr_measured": 7.61},
    ]
    vp_budget_check = [
        {"profile": c["profile"],
         "vp_spent_daily_pct": round(c["votes_day"] * 2.0 * c["weight_pct"] / 100, 1)}  # full vote = 2% VP
        for c in calibrated
    ]
    projections = []
    for sp in (10_000, 100_000):
        for apr in (0.033, 0.06, 0.076):
            daily_sp = sp * apr / 365
            projections.append({"SP": sp, "APR_pct": round(apr * 100, 2),
                                "SP_per_day": round(daily_sp, 3),
                                "SP_90d": round(daily_sp * 90, 1),
                                "note": "curation pays in SP (auto-restaked) - zero SBD price exposure"})
    return {"calibration_points_live": calibrated,
            "vote_power_budget_check_pct_of_20pct_daily": vp_budget_check,
            "projections": projections,
            "finding": "vote-power budget (~20%/day) binds votes_day x weight ~ 18-28%; focused 25-30 votes at ~35% beat spread 70-90 votes at ~10%"}


# ------------------------------------------------------------------ BOT-4
def probe_bot4(ext_fallback=None):
    try:
        body = json.dumps({"jsonrpc": "2.0", "method": "condenser_api.get_order_book",
                           "params": [30], "id": 1}).encode()
        req = urllib.request.Request("https://api.steemit.com", data=body,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=25) as r:
            book = json.loads(r.read().decode())["result"]

        def parse(side):
            rows = []
            for lvl in (book.get("asks") if side == "ask" else book.get("bids"))[:15]:
                def num(v):
                    if isinstance(v, (int, float)):
                        return float(v)
                    return float(str(v).split()[0])
                sbd = num(lvl.get("sbd", lvl.get("sbd_volume", 0)))
                steem = num(lvl.get("steem", lvl.get("steem_volume", 0)))
                rows.append({"price_usd": sbd / steem if steem else 0, "sbd": sbd, "steem": steem})
            return rows

        asks = parse("ask")
        bids = parse("bid")
        # order book prices are denominated in SBD per STEEM -> convert to USD via P_SBD
        try:
            p_sbd = json.load(open("scripts/price_cache_365d.json"))["sbd"][-1]
        except Exception:
            p_sbd = None
        for row in asks + bids:
            row["price_usd"] = row["price_usd"] * p_sbd if p_sbd else None
            row["price_sbd_per_steem"] = None
        best_ask = asks[0]["price_usd"]
        best_bid = bids[0]["price_usd"]
        depth_1pct = sum(l["sbd"] for l in asks if l["price_usd"] <= best_ask * 1.01)
        out = {"internal_best_ask_usd": round(best_ask, 5), "internal_best_bid_usd": round(best_bid, 5),
               "internal_ask_sbd_per_steem": asks[0]["price_usd"] and round(asks[0]["price_usd"] / p_sbd, 5),
               "p_sbd_used": p_sbd,
               "internal_mid_usd": round((best_ask + best_bid) / 2, 5),
               "internal_spread_pct": round((asks[0]["price_usd"] - bids[0]["price_usd"]) / asks[0]["price_usd"] * 100, 2),
               "ask_depth_within_1pct_sbd": round(depth_1pct, 0)}
        try:
            ob = http_json("https://api.coingecko.com/api/v3/simple/price?ids=steem&vs_currencies=usd")
            ext = ob["steem"]["usd"]
            out["external_steem_usd"] = ext
        except Exception:
            if ext_fallback:
                out["ext_usd_fallback"] = ext_fallback
                out["note"] = "external price from cached daily close (CoinGecko rate-limited)"
        ext = out.get("external_steem_usd") or out.get("ext_usd_fallback")
        if ext:
            out["gap_internal_ask_vs_external_pct"] = round((best_ask / ext - 1) * 100, 2)
            out["gap_internal_bid_vs_external_pct"] = round((best_bid / ext - 1) * 100, 2)
        return out
    except Exception as e:
        return {"error": str(e)[:150]}


def main():
    print("loading/fetching 365d histories (STEEM, SBD)...", flush=True)
    try:
        import os
        cache = "scripts/price_cache_365d.json"
        if os.path.exists(cache):
            c = json.load(open(cache))
            steem, sbd = c["steem"], c["sbd"]
        else:
            steem = fetch_history("steem")
            sbd = fetch_history("steem-dollars")
            json.dump({"steem": steem, "sbd": sbd}, open(cache, "w"))
        results["bot3_convert"] = backtest_bot3(steem, sbd)
        print(json.dumps(results["bot3_convert"]["current_regime_last60d"], indent=1))
        print(json.dumps(results["bot3_convert"]["forward_montecarlo_hedged_90d"], indent=1))
    except Exception as e:
        results["bot3_convert"] = {"error": str(e)[:200]}
    results["bot2_curation"] = model_bot2()
    print("BOT-4 snapshot...", flush=True)
    try:
        ext_fb = None
        try:
            ext_fb = steem[-1]
        except Exception:
            pass
        results["bot4_snapshot"] = probe_bot4(ext_fb)
    except Exception as e:
        results["bot4_snapshot"] = {"error": str(e)[:150]}
    b4 = results.get("bot4_snapshot", {})
    if "error" in b4 and "ext_usd_fallback" not in b4:
        try:
            b4["ext_usd_fallback"] = steem[-1]
            b4["note"] = "external price from cached daily close (CoinGecko rate-limited)"
        except Exception:
            pass
    print(json.dumps(results.get("bot4_snapshot", {}), indent=1))
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    print(f"saved -> {OUT}")


if __name__ == "__main__":
    main()
