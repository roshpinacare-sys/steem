#!/usr/bin/env python3
"""Wave-4 live measurements — read-only queries against api.steemit.com.
Every command here is reproducible evidence for docs/EXPLORATION_WAVE4.md."""
import json, urllib.request, sys

RPC = "https://api.steemit.com"

def call(method, params, _id=1):
    payload = json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": _id}).encode()
    req = urllib.request.Request(RPC, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        out = json.loads(r.read().decode())
    if "error" in out:
        return {"__rpc_error__": out["error"].get("message", str(out["error"]))}
    return out.get("result")

def section(title):
    print(f"\n=== {title} ===")

# 1) Chain state + hardfork
section("1. dynamic_global_properties + hardfork")
dgp = call("condenser_api.get_dynamic_global_properties", [])
hf = call("condenser_api.get_hardfork_version", [])
print(json.dumps({
    "head_block": dgp.get("head_block_number"),
    "time": dgp.get("time"),
    "current_supply_steem": dgp.get("current_supply"),
    "current_sbd_supply": dgp.get("current_sbd_supply"),
    "total_vesting_fund": dgp.get("total_vesting_fund_steem"),
    "total_vesting_shares": dgp.get("total_vesting_shares"),
    "sbd_interest_rate": dgp.get("sbd_interest_rate"),
    "account_creation_fee": dgp.get("account_creation_fee"),
    "hardfork": hf,
}, indent=1))

# 2) Chain properties (account_creation_fee, sbd_interest_rate official)
section("2. chain_properties")
cp = call("condenser_api.get_chain_properties", [])
print(json.dumps(cp, indent=1))

# 3) Feed history → convert edge
section("3. feed_history")
fh = call("condenser_api.get_feed_history", [])
print(json.dumps({
    "current_median_hist": fh.get("current_median_hist"),
    "last_3": fh.get("price_history", [])[:3],
}, indent=1))

# 4) Reward fund
section("4. reward_fund post")
rf = call("condenser_api.get_reward_fund", ["post"])
print(json.dumps({k: rf.get(k) for k in ("reward_balance", "recent_claims")}, indent=1))

# 5) Internal market spread
section("5. order_book (25)")
ob = call("condenser_api.get_order_book", [25])

def _rp(entry):
    rp = entry.get("real_price")
    if rp:
        return float(rp)
    op = entry.get("order_price") or {}
    base = float((op.get("base") or "0").split()[0])
    quote = float((op.get("quote") or "0").split()[0])
    return base / quote if quote else 0.0

asks = [(_rp(a), float(a.get("steem", 0))) for a in ob.get("asks", [])][:5]
bids = [(_rp(b), float(b.get("steem", 0))) for b in ob.get("bids", [])][:5]
if asks and bids:
    spread = (asks[0][0] - bids[0][0]) / bids[0][0] * 100
    print(f"best ask {asks[0][0]:.5f} / best bid {bids[0][0]:.5f} → spread {spread:.2f}%")
    print(f"top5 asks (price SBD-per-STEEM, size STEEM) {[(round(p,5), s) for p, s in asks]}")
    print(f"top5 bids (price, size) {[(round(p,5), s) for p, s in bids]}")
    book_liquidity = sum(s for p, s in asks if p < 0.12)
    print(f"ask liquidity under 0.12: {book_liquidity:.1f} STEEM")
else:
    print("EMPTY BOOK", json.dumps(ob)[:400])

# 6) DHF: top proposals + steem.dao (return proposal) + treasury account
section("6. DHF top by_total_votes (descending)")
try:
    pr = call("condenser_api.list_proposals", [["999999999999999999999999999999"], 10, "by_total_votes", "descending"])
    for p in (pr or []):
        print(json.dumps({
            "id": p.get("id"), "creator": p.get("creator"),
            "daily_pay": p.get("daily_pay"),
            "total_vests_votes": p.get("total_votes"),
            "subject": p.get("subject", "")[:50],
        }))
except Exception as e:
    print("desc failed:", e)

section("6z. DHF bottom by_total_votes (ascending — return-proposal zone)")
try:
    pr0 = call("condenser_api.list_proposals", [["0"], 12, "by_total_votes", "ascending"])
    for p in (pr0 or []):
        print(json.dumps({
            "id": p.get("id"), "creator": p.get("creator"), "status": p.get("status"),
            "daily_pay": p.get("daily_pay"),
            "total_vests_votes": p.get("total_votes"),
            "subject": p.get("subject", "")[:50],
        }))
except Exception as e:
    print("asc failed:", e)

section("6c. steem.dao account")
dao = call("condenser_api.get_accounts", [["steem.dao"]])
if dao:
    a = dao[0]
    print(json.dumps({
        "balance": a.get("balance"), "sbd_balance": a.get("sbd_balance"),
        "vesting_shares": a.get("vesting_shares"),
        "reward_steem": a.get("reward_steem_balance"),
    }, indent=1))

# 7) Witnesses by vote → threshold curve
section("7. witnesses by vote (top 100 in chunks)")
rank = 0
thresholds = {}
cursor = ""
for chunk in range(4):
    ws = call("condenser_api.get_witnesses_by_vote", [cursor, 25]) or []
    if not ws:
        break
    for w in ws:
        rank += 1
        if rank in (1, 20, 50, 75, 100, len(ws) and rank):
            thresholds[rank] = (w.get("owner"), w.get("votes"))
        if rank >= 100:
            break
    cursor = ws[-1].get("owner")
    if rank >= 100:
        break
for r, (owner, votes) in sorted(thresholds.items()):
    print(f"rank {r}: {owner} votes(VESTS)={votes}")

section("7b. witness_schedule")
wsch = call("condenser_api.get_witness_schedule", [])
print(json.dumps({
    "median_props_account_creation_fee": (wsch.get("median_props") or {}).get("account_creation_fee"),
    "majority_version": wsch.get("majority_version"),
    "num_scheduled": wsch.get("num_scheduled_witnesses"),
}, indent=1))

# 7c) external prices → convert edge computation
section("7c. external prices (CoinGecko) + convert edge")
try:
    with urllib.request.urlopen("https://api.coingecko.com/api/v3/simple/price?ids=steem,steem-dollars&vs_currencies=usd", timeout=15) as r:
        cg = json.loads(r.read().decode())
    steem_usd = cg["steem"]["usd"]
    sbd_usd = cg["steem-dollars"]["usd"]
except Exception as e:
    print("coingecko failed:", e)
    steem_usd, sbd_usd = 0.043, 0.398
print(f"STEEM=${steem_usd}  SBD=${sbd_usd}")
feed = float((fh.get("price_history") or [{"base": "0 SBD"}])[0]["base"].split()[0])
if feed > 0:
    steem_per_sbd = 1.0 / feed
    convert_usd = steem_per_sbd * steem_usd
    print(f"feed={feed} SBD/STEEM → 1 SBD converts to {steem_per_sbd:.2f} STEEM = ${convert_usd:.3f}")
    print(f"edge vs SBD market: {(convert_usd / sbd_usd - 1) * 100:+.1f}%")
    if asks and bids:
        best_ask = asks[0][0]
        sbd_out = steem_per_sbd * best_ask
        print(f"edge via internal market (sell STEEM at ask): 1 SBD → {sbd_out:.3f} SBD ({(sbd_out - 1) * 100:+.1f}% per 3.5d cycle)")

# 8) headcorner refresh
section("8. headcorner refresh")
hc = call("condenser_api.get_accounts", [["headcorner"]])
rc = call("rc_api.find_rc_accounts", {"accounts": ["headcorner"]})
if hc:
    a = hc[0]
    vp_regen = True
    max_rc = int(rc["rc_accounts"][0].get("max_rc", "0"))
    cur_mana = int(rc["rc_accounts"][0]["rc_manabar"]["current_mana"])
    print(json.dumps({
        "balance": a.get("balance"), "sbd_balance": a.get("sbd_balance"),
        "vesting_shares": a.get("vesting_shares"), "received_vesting": a.get("received_vesting_shares"),
        "delegated_vesting": a.get("delegated_vesting_shares"),
        "voting_power": a.get("voting_power"),
        "reward_steem": a.get("reward_steem_balance"), "reward_sbd": a.get("reward_sbd_balance"),
        "reward_vests": a.get("reward_vesting_balance"),
        "savings_balance": a.get("savings_balance"), "savings_sbd": a.get("savings_sbd_balance"),
        "posting_auths_count": len((a.get("posting") or {}).get("account_auths", [])),
        "rc_pct": round(cur_mana / max(1, max_rc) * 100, 1),
    }, indent=1))

print("\nDONE")
