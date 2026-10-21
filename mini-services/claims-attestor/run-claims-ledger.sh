#!/usr/bin/env bash
# run-claims-ledger.sh — רץ-פנקס-הטענות-החי-מהצומת-:3016 (W121 · גל-115 · agent-2)
# החוזה של claims-attestor (parseLedger):
#   == LEDGER: <measured-true> / <refuted> (of <total>)
#   == refuted:<id1> <id2> ...
# אפס-המצאה: כל-טענה-נמדדת-טרייה-מהמקור-החי; כשל-אחזור = טענה-כושלת-אחת-כנה.
python3 - <<'PY'
import json, urllib.request
try:
    with urllib.request.urlopen("http://127.0.0.1:3016/claims", timeout=180) as r:
        d = json.load(r)
    claims = d if isinstance(d, list) else d.get("claims", d.get("items", []))
    refuted = [str(c.get("id", "?")) for c in claims if c.get("pass") is False]
    measured = sum(1 for c in claims if c.get("pass") is True)
    total = len(claims)
    print(f"== LEDGER: {measured} / {len(refuted)} (of {total})")
    print("== refuted:" + (" ".join(refuted) if refuted else ""))
except Exception as e:
    print("== LEDGER: 0 / 1 (of 1)")
    print("== refuted:claims-fetch-failed")
PY
