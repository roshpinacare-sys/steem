#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# run-claims-ledger.sh — פנקס-טענות-חי (G37 · גל-116 · agent-2 · תעלול-עמיתים-R310)
# כל-טענה = מבחן-פלסיבילי-חי (אפס-סיפורים · אפס-מצב-שמור · מדידה-טרייה-בכל-ריצה).
# פורמט-פלט = חוזה-העורגן (claims-attestor :3045 · agent-zai R310):
#   == LEDGER: <P> MEASURED-TRUE / <F> REFUTED (of <T>)
#   == refuted: <id1> <id2> ...
# טענה-בלי-מדידה (null) = SKIPPED — לא-נספרת-ב-T (כנות: אין-לה-פסק-דין).
# ═══════════════════════════════════════════════════════════════════════════
set -u

python3 - <<'PYEOF'
import json, subprocess, sys

def curl_json(url, timeout=8):
    try:
        out = subprocess.run(["curl", "-s", "--max-time", str(timeout), url],
                             capture_output=True, text=True, timeout=timeout + 2).stdout
        return json.loads(out) if out.strip() else None
    except Exception:
        return None

results = []  # (id, pass: True|False|None)

# ── הכלכלה-הריבונית: פנקס-הטענות-החי-של-המנוע (:3016/claims · G37) ──
cl = curl_json("http://127.0.0.1:3016/claims")
if cl is None or not cl.get("ok"):
    results.append(("economy-claims-surface", False))
else:
    results.append(("economy-claims-surface", True))
    for c in cl.get("claims", []):
        cid = "economy." + str(c.get("id", "?"))
        p = c.get("pass")
        results.append((cid, None if p is None else bool(p)))

# ── קונסולת-הבעלים (:3000) — דלת-הבית-חייבת-להיפתח ──
try:
    code = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                           "--max-time", "8", "http://127.0.0.1:3000/api/sovereign/claims"],
                          capture_output=True, text=True, timeout=10).stdout.strip()
    results.append(("console.claims-gate", code == "200"))
except Exception:
    results.append(("console.claims-gate", False))

passed = [r for r in results if r[1] is True]
failed = [r for r in results if r[1] is False]
total = len(passed) + len(failed)

for rid, p in results:
    print(f"CLAIM {rid}: {'TRUE' if p is True else ('FALSE' if p is False else 'SKIPPED-NO-MEASUREMENT')}")
print(f"== LEDGER: {len(passed)} MEASURED-TRUE / {len(failed)} REFUTED (of {total})")
print("== refuted: " + " ".join(r[0] for r in failed))
PYEOF
