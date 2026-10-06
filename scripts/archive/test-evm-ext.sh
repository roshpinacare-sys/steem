#!/usr/bin/env bash
# THE WEAVE · Task 5 backend test-suite (EVM extension)
# מריץ את מלוא מחזורי ה-EVM מול השרת החי. לא בדיקת יחידה — בדיקות חיות.
set -u
cd /home/z/my-project

# ── הרם שרת אם אין (מת בסוף הקריאה — זה מכניקת הסנדבוקס) ──
if ! curl -s -m 2 http://localhost:3000/api/weave/state >/dev/null 2>&1; then
  (setsid bun run dev >/dev/null 2>&1 &)
  for _ in $(seq 1 40); do
    curl -s -m 2 http://localhost:3000/api/weave/state >/dev/null 2>&1 && break
    sleep 1
  done
fi
echo "server: $(curl -s -m 5 http://localhost:3000/api/weave/state | head -c 40)"

PY() { python3 -c "$1"; }
RELAYER_ID="cmu18b4h4002hsqwzhd6azjek"
AUDITOR_ID="cmu16xzwa001bsqwz1ryi8041"

echo; echo "=== 1. anchor/simulate index=1 ==="
curl -s -m 90 -X POST http://localhost:3000/api/weave/anchor/simulate \
  -H "Content-Type: application/json" -d '{"index":1}' > /tmp/t1.json
PY "
import json
d=json.load(open('/tmp/t1.json'))
if not d.get('ok'): print('FAIL:', d.get('error')); raise SystemExit
a=d['anchor']
print('registryIndex:', a['registryIndex'], '| root:', a['root'][:16]+'…', '| range:', a['attFrom'],'-',a['attTo'])
print('checkpoint anchorStatus:', d['checkpoint']['anchorStatus'], '/', d['checkpoint']['anchorNet'])
print('anchoredBy:', a['anchoredBy'][:14]+'…')"

echo; echo "=== 2. simulate again → 409 ==="
curl -s -m 30 -X POST http://localhost:3000/api/weave/anchor/simulate \
  -H "Content-Type: application/json" -d '{"index":1}'

echo; echo; echo "=== 3. registry list ==="
curl -s -m 30 http://localhost:3000/api/weave/registry | PY "
import json,sys
d=json.load(sys.stdin)
print('anchors:', len(d['anchors']), '| first root:', d['anchors'][0]['root'][:16]+'…')"

echo; echo "=== 4. registry/verify seq=3 (cp1 מעוגן) ==="
curl -s -m 90 -X POST http://localhost:3000/api/weave/registry/verify \
  -H "Content-Type: application/json" -d '{"seq":3}' > /tmp/t4.json
PY "
import json
r=json.load(open('/tmp/t4.json'))
if not r.get('ok'): print('FAIL:', r.get('error')); raise SystemExit
r=r['report']
print('mode:', r['mode'], '| seq:', r['seq'], '| cp:', r['checkpointIndex'], '| regIdx:', r['registryIndex'])
print('rootInRegistry:', r['rootInRegistry'], '| proofValid:', r['proofValid'], '| leafRecomputedMatch:', r['leafRecomputedMatch'], '| proofLen:', len(r['proof']))"

echo; echo "=== 5. registry/verify seq=8 (cp2 לא עוגן → 400) ==="
curl -s -m 30 -X POST http://localhost:3000/api/weave/registry/verify \
  -H "Content-Type: application/json" -d '{"seq":8}'

echo; echo; echo "=== 6. challenge create (weave-relayer) ==="
CH=$(curl -s -m 30 -X POST http://localhost:3000/api/agents/challenge \
  -H "Content-Type: application/json" -d "{\"agentId\":\"$RELAYER_ID\"}")
echo "$CH" | PY "
import json,sys
c=json.load(sys.stdin)['challenge']
print('nonce:', c['nonce'], '| digest:', c['digest'][:16]+'…')"
NONCE=$(echo "$CH" | PY "import json,sys; print(json.load(sys.stdin)['challenge']['nonce'])")

echo; echo "=== 7. challenge sign (סימולציית סוכן DEVNET) ==="
SIG=$(curl -s -m 30 -X POST http://localhost:3000/api/agents/challenge/sign \
  -H "Content-Type: application/json" -d "{\"agentId\":\"$RELAYER_ID\",\"nonce\":$NONCE}")
echo "$SIG" | PY "
import json,sys
d=json.load(sys.stdin)
print('sig:', d['signature'][:18]+'…')"
SIGNATURE=$(echo "$SIG" | PY "import json,sys; print(json.load(sys.stdin)['signature'])")

echo; echo "=== 8. challenge verify → nonce נצרך ==="
curl -s -m 30 -X POST http://localhost:3000/api/agents/challenge/verify \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$RELAYER_ID\",\"nonce\":$NONCE,\"signature\":\"$SIGNATURE\"}" | PY "
import json,sys
v=json.load(sys.stdin)['verified']
print('consumedNonce:', v['consumedNonce'], '| recovered:', v['recovered'])"

echo; echo "=== 9. אותה חתימה שוב → 409 replay ==="
curl -s -m 30 -X POST http://localhost:3000/api/agents/challenge/verify \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$RELAYER_ID\",\"nonce\":$NONCE,\"signature\":\"$SIGNATURE\"}"

echo; echo; echo "=== 10. rotate weave-relayer ==="
curl -s -m 90 -X POST http://localhost:3000/api/agents/rotate \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$RELAYER_ID\",\"note\":\"demo EVM-3\"}" > /tmp/t10.json
PY "
import json
d=json.load(open('/tmp/t10.json'))
if not d.get('ok'): print('FAIL:', d.get('error')); raise SystemExit
op=d['op']; ag=d['agent']
print('op nonce:', op['nonce'], '| old:', op['oldAddress'][:12]+'…', '→ new:', op['newAddress'][:12]+'…')
print('digest:', op['digest'][:16]+'…', '| recovered===old:', op['recovered']==op['oldAddress'])
print('agent.ethAddress חדש:', ag['ethAddress'][:12]+'…')"

echo; echo "=== 11. replay-demo — מפתח ישן נדחה ==="
curl -s -m 30 -X POST http://localhost:3000/api/agents/rotate/replay-demo \
  -H "Content-Type: application/json" -d "{\"agentId\":\"$RELAYER_ID\"}" | PY "
import json,sys
r=json.load(sys.stdin)['result']
print('rejected:', r['rejected'], '| attempted:', r['attemptedAddress'][:12]+'…', '≠ active:', r['activeAddress'][:12]+'…')"

echo; echo "=== 12. evm3 stats ==="
curl -s -m 30 http://localhost:3000/api/weave/evm3 | PY "
import json,sys
s=json.load(sys.stdin)['stats']
print('rotations:', s['rotations'], '| challengesVerified:', s['challengesVerified'], '| replaysBlocked:', s['replaysBlocked'])"

echo; echo "=== 13. שרשרת עדיין תקינה? ==="
curl -s -m 90 -X POST http://localhost:3000/api/weave/verify | PY "
import json,sys
r=json.load(sys.stdin)['report']
print('valid:', r['valid'], '| checked:', r['checked'], '| sigOk:', r['sigOk'], '| sigFail:', r['sigFail'])"

echo; echo "=== 14. rotate weave-auditor (עם אימותים → 400) ==="
curl -s -m 30 -X POST http://localhost:3000/api/agents/rotate \
  -H "Content-Type: application/json" -d "{\"agentId\":\"$AUDITOR_ID\"}"

echo; echo "=== done ==="
