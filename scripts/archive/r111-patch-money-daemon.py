#!/usr/bin/env python3
# R111 — החלפה כירורגית בקובץ הדיבון (RTL-safe)
import io, sys

p = "mini-services/money/index.ts"
src = io.open(p, encoding="utf-8").read()
changed = []

def swap(old, new, tag):
    global src
    n = src.count(old)
    if n != 1:
        print(f"FAIL {tag}: anchor x{n}")
        sys.exit(1)
    src = src.replace(old, new)
    changed.append(tag)

# ── B1: טריגר הגל — חתימת הון-כולל (R111) ──
swap(
    "  const idleNow = Number(meas?.idleSteem ?? 0);\n  const today = utcDay();\n  if (\n    idleNow >= POLICY.liquidityStream.waveSteem &&\n    state.lastStreamDay !== today\n  ) {",
    "  // R111 - law of the total-capital signature: liquid>=200 alone is NOT a\n"
    "  // wave. Measured live 04:15: standing ladder capital re-appeared liquid\n"
    "  // after order churn and masqueraded as a powerdown wave -> false wrap of\n"
    "  // 95.327 WSTEEM from ladder capital. A true wave is a rise in the TOTAL\n"
    "  // capital (liquid + deployed in orders) above the previous beat's total.\n"
    "  // Cancels and re-deploys never change the total and cannot fire it.\n"
    "  const idleNow = Number(meas?.idleSteem ?? 0);\n"
    "  const totalSteemNow = Math.round((idleNow + Number(meas?.deployedSteem ?? 0)) * 1000) / 1000;\n"
    "  const measCredible =\n"
    "    !!meas && typeof meas === \"object\" && typeof meas?.idleSteem === \"number\" && totalSteemNow > 0;\n"
    "  const prevTotal = state.lastTotalSteem ?? null;\n"
    "  if (measCredible) state.lastTotalSteem = totalSteemNow; // wave = rise vs previous picture\n"
    "  const today = utcDay();\n"
    "  const waveDelta = prevTotal != null ? Math.round((totalSteemNow - prevTotal) * 1000) / 1000 : 0;\n"
    "  if (\n"
    "    measCredible &&\n"
    "    waveDelta >= POLICY.liquidityStream.waveSteem &&\n"
    "    idleNow >= POLICY.liquidityStream.waveSteem &&\n"
    "    state.lastStreamDay !== today\n"
    "  ) {",
    "B1-wave-trigger",
)

# שורת הסיבה של הגל — עוגן ASCII בלבד בקצוות
import re
m = re.search(r"reason: `גל דלק נזיל \$\{idleNow\.toFixed\(0\)\} STEEM[^`]*`,", src)
if not m:
    print("FAIL B1-reason: regex no match"); sys.exit(1)
src = src[:m.start()] + "reason: `גל דלק אמיתי: ההון-הכולל עלה ${waveDelta.toFixed(3)} STEEM מעל המדידה הקודמת (${totalSteemNow.toFixed(3)} סך · נזיל ${idleNow.toFixed(0)}) — ${Math.round(POLICY.liquidityStream.share * 100)}% הופכים לעומק בבריכות הזירה לפני פריסת הסולם`," + src[m.end():]
changed.append("B1-wave-reason")

# ── B2: בדיקה מוקדמת ל-stock-sbd (R111) ──
swap(
    "  const armStock = meas?.sbdArming;\n  const parityStock = Number(meas?.marks?.parity);\n  if (armStock?.state === \"WAIT\" && Number.isFinite(parityStock) && parityStock > 0) {",
    "  // R111 - pre-check law (born from a live starvation loop): the fire is\n"
    "  // checked against the executable bid from the measurement itself BEFORE\n"
    "  // burning action-budget and cooldown on it. True cost premium:\n"
    "  // parity/bid - 1 (how many STEEM above fair one SBD costs when executing\n"
    "  // into bids). Above the cap the decision honestly falls through (ladder\n"
    "  // deploy, HIVE leg) instead of looping on a guaranteed refusal.\n"
    "  const armStock = meas?.sbdArming;\n"
    "  const parityStock = Number(meas?.marks?.parity);\n"
    "  const bidPxStock = Number(meas?.book?.bids?.[0]?.price);\n"
    "  const premiumBpsStock =\n"
    "    Number.isFinite(parityStock) && parityStock > 0 && Number.isFinite(bidPxStock) && bidPxStock > 0\n"
    "      ? Math.round((parityStock / bidPxStock - 1) * 10_000)\n"
    "      : null;\n"
    "  if (\n"
    "    armStock?.state === \"WAIT\" &&\n"
    "    Number.isFinite(parityStock) &&\n"
    "    parityStock > 0 &&\n"
    "    premiumBpsStock != null &&\n"
    "    premiumBpsStock <= POLICY.stockSbd.premiumCapBps\n"
    "  ) {",
    "B2-stock-precheck",
)

swap(
    "reason: `SBD arming gap ${Number(armStock.commitable).toFixed(3)}/${armStock.needed} - idle STEEM covers it - closing at the ask (bounded stock, premium cap ${POLICY.stockSbd.premiumCapBps}bps)`,",
    "reason: `SBD arming gap ${Number(armStock.commitable).toFixed(3)}/${armStock.needed} - executable bid ${bidPxStock.toFixed(6)} within cap (premium ${premiumBpsStock}bps <= ${POLICY.stockSbd.premiumCapBps}) - closing at the bid (bounded stock)`,",
    "B2-stock-reason",
)

io.open(p, "w", encoding="utf-8").write(src)
print("OK:", ", ".join(changed))
