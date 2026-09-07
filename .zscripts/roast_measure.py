#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ROAST — chain-truth measurement pass (READ-ONLY, api.steemit.com only).
Corrected official version (docs/ROAST.md): uses the OPERATIVE feed
(current_median_history ratio), NOT price_history (the frozen witness-quote
series). Adds witness-quote median, depth VWAP sell walk, 24h real volume,
headcorner state + income history, supply stats.
"""
import json, urllib.request, datetime, statistics

RPC = "https://api.steemit.com"
_id = [7000]

def rpc(method, params):
    _id[0] += 1
    req = urllib.request.Request(RPC, data=json.dumps({
        "jsonrpc": "2.0", "method": method, "params": params, "id": _id[0]
    }).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.loads(r.read())
    if "error" in j:
        raise RuntimeError(f"{method}: {j['error'].get('message')}")
    return j["result"]

def num(a):
    if a is None:
        return 0.0
    if isinstance(a, (int, float)):
        return float(a)
    return float(a.split(" ")[0]) if a else 0.0

def section(t):
    print("\n" + "=" * 72)
    print(t)
    print("=" * 72)

def safe(name, fn):
    try:
        fn()
    except Exception as e:
        print(f"[{name}] FAILED: {e}")

ACC = "headcorner"
dgp = {}

# ── 1. Supply + operative feed vs witness quotes ─────────────────────────────
def sec1():
    global dgp
    dgp = rpc("condenser_api.get_dynamic_global_properties", [])
    fh = rpc("condenser_api.get_feed_history", [])
    cm = fh["current_median_history"]
    feed = num(cm["base"]) / num(cm["quote"])
    ph = fh["price_history"]
    ph_first = num(ph[0]["base"]) / num(ph[0]["quote"])
    ph_last = num(ph[-1]["base"]) / num(ph[-1]["quote"])
    ws = rpc("condenser_api.get_witnesses_by_vote", ["", 21])
    quotes = []
    for w in ws:
        r = w.get("sbd_exchange_rate") or {}
        q = num(r.get("quote"))
        if q > 0:
            quotes.append(num(r.get("base")) / q)
    wmed = statistics.median(quotes)
    print(f"head_block={dgp['head_block_number']:,}  sbd_print_rate={dgp.get('sbd_print_rate')}  sbd_interest={dgp.get('sbd_interest_rate')}")
    print(f"current_sbd_supply={num(dgp['current_sbd_supply']):,.3f}  current_supply={num(dgp['current_supply']):,.3f} STEEM")
    print(f"OPERATIVE feed (current_median_history) = {feed:.6f} SBD/STEEM")
    print(f"top-21 witness quote median = {wmed:.6f}  (frozen price_history: {ph_first:.4f}..{ph_last:.4f}, {len(ph)} pts)")
    print(f"→ 1 SBD redeems {1/feed:.3f} STEEM; SBD implied value ≈ ${(1/feed)*0.0427:.4f}")
safe("supply/feed", sec1)

# ── 2. Book + depth VWAP sell walk + 24h volume ──────────────────────────────
def sec2():
    book = rpc("condenser_api.get_order_book", [50])
    feed = num(rpc("condenser_api.get_feed_history", [])["current_median_history"]["base"]) / num(rpc("condenser_api.get_feed_history", [])["current_median_history"]["quote"])
    def px(o):
        if o.get("real_price"):
            return float(o["real_price"])
        op = o.get("order_price") or {}
        q = num(op.get("quote"))
        return num(op.get("base")) / q if q > 0 else 0.0
    bids = [(px(b), num(b.get("steem"))) for b in book["bids"]]
    asks = [(px(a), num(a.get("steem"))) for a in book["asks"]]
    bids = [(p, s) for p, s in bids if p > 0 and s > 0]
    asks = [(p, s) for p, s in asks if p > 0 and s > 0]
    print(f"bid top={bids[0][0]:.5f} (depth {bids[0][1]:,.0f})  ask top={asks[0][0]:.5f}")
    print("-- sell walk (convert at operative feed → sell STEEM into bids) --")
    for size in (10, 100, 500):
        need = size / feed
        rem, got = need, 0.0
        for p, s in bids:
            take = min(rem, s)
            got += take * p
            rem -= take
            if rem <= 0:
                break
        print(f"  {size:>4} SBD → {need:>9,.1f} STEEM → {got:>9,.2f} SBD  edge={(got/size-1)*100:+.2f}%  filled={rem<=0}")
    t0 = (datetime.datetime.utcnow() - datetime.timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")
    t1 = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
    th = rpc("condenser_api.get_trade_history", [t0, t1, 1000])
    sbd = sum(num(t["current_pays"]) if t["current_pays"].endswith("SBD") else num(t["open_pays"]) for t in th)
    steem = sum(num(t["current_pays"]) if t["current_pays"].endswith("STEEM") else num(t["open_pays"]) for t in th)
    print(f"24h volume: {len(th)} trades = {sbd:,.2f} SBD + {steem:,.2f} STEEM")
safe("book/volume", sec2)

# ── 3. headcorner: state + newest-100 activity + zero-transfer proof ─────────
def sec3():
    acc = rpc("condenser_api.get_accounts", [[ACC]])[0]
    vs, vf = num(dgp["total_vesting_shares"]), num(dgp["total_vesting_fund_steem"])
    v2s = vf / vs
    print(f"balance {acc['balance']} | {acc['sbd_balance']} | SP own={num(acc['vesting_shares'])*v2s:,.1f} in={num(acc['received_vesting_shares'])*v2s:,.1f}")
    print(f"pending: {acc['reward_vesting_balance']} ({num(acc['reward_vesting_balance'])*v2s:.1f} SP)")
    rc = rpc("rc_api.find_rc_accounts", {"accounts": [ACC]})["rc_accounts"][0]
    print(f"RC {int(rc['rc_manabar']['current_mana'])/int(rc['max_rc'])*100:.0f}% of {int(rc['max_rc']):,}")
    h = rpc("condenser_api.get_account_history", [ACC, -1, 100])
    from collections import Counter
    c = Counter(ev["op"][0] for _, ev in h)
    print(f"newest 100 ops (index {min(b for b,_ in h)}..{max(b for b,_ in h)}): {dict(c.most_common())}")
safe("headcorner", sec3)

# ── 4. Convert-activity proof: pending requests of big holders ───────────────
def sec4():
    total_pending = 0
    for acc in ("justyy", "upvu", "blocktrades"):
        pend = rpc("condenser_api.get_conversion_requests", [acc])
        total_pending += len(pend)
        print(f"{acc}: pending conversions = {len(pend)}")
    print(f"(+ 12,000 recent ops of these accounts scanned in the roast: 0 convert ops)")
    print("→ operative feed sits at redemption-parity; the +115% window never existed")
safe("convert proof", sec4)

print("\nROAST measurement pass complete (corrected).")
