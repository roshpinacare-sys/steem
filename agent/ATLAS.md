# ATLAS — המפה המלאה של SAOS (R267)

> המקום-היחיד שעונה "איפה-כל-דבר". כל-נתיב שמופיע כאן נאמת ע"י `scripts/doctrine-audit.mjs` — נתיב-מת שייככב-כאן = המבחן-נופל = עוצרים-הכל.
> עדכון-האטלס חלק-מהקומיט שמשנה את המציאות. לעולם לא אחר-כך.

---

## 1 · האיברים (mini-services, פורטים-מקור-אמת: index.ts)

| שירות | נתיב | פורט | תפקיד |
|---|---|---|---|
| cockpit | `src/app/page.tsx` (Next.js 16) | 3000 | התצוגה-החיה; route-יחיד למשתמש |
| saos-engine | `mini-services/saos-engine/index.ts` | 3040 | המוח — מחזורים, תוכן, חיילים, כספת |
| saos-custodian | `mini-services/saos-custodian/index.ts` | 3041 | החותם-היחיד (GPG/custody) |
| saos-metrics | `mini-services/saos-metrics/index.ts` | 3042 | מדידות |
| saos-builder | `mini-services/saos-builder/index.ts` | 3043 | בניית-תוכן |
| dev-keeper | `mini-services/dev-keeper/` | 3044 | היגיינת-dev-cache |

Gateway: ה-Caddyfile מעביר `?XTransformPort=` → הפורט-המבוקש; ברירת-מחדל → 3000.

## 2 · המנוע — מיון-הסקריפטים (`mini-services/saos-engine/`)

**איברים-חיים (מיובאים-ל-index.ts ולמחזור):**
`lib.mjs` (כתיבה-אטומית/חוק-הכתיבה-השלמה) · `bus.mjs` · `signer.mjs` (האימוץ-הfail-closed) · `steemtx.mjs` (קריפטו: wif/pubkey/serialize/sign, SEED_ORDERS) · `hive.mjs` (rpcHive, HIVE_ROSTER, RC-מתמטיקה, pickVaultKey) · `vault-revival.mjs` (כספת→זיכרון, ARMY_ROSTER, דורות) · `vault unlock` חי גם ב-probes · `army-social.mjs` (צינור-הגילוח/תגובות על Steem) · `hive-social.mjs` · `hive-profiles.mjs` · `content.mjs` (corpus-רצפה) · `promo.mjs` (The-Daily-Ledger) · `illustrate.mjs` · `personas.mjs` · `council.mjs` · `grid.mjs` · `hypergrid.mjs` · `fleet.mjs` · `soldiers.mjs` · `recruiter.mjs` · `community.mjs` · `curator.mjs` · `discovery.mjs` · `intel.mjs` · `webintel.mjs` · `economics.mjs` · `payouts.mjs` · `measure.mjs` · `learning.mjs` · `adaptation.mjs` · `bridge-guard.mjs` (סערת-429/502) · `spamgate.mjs` · `rc-pool.mjs` (planLifts) · `rctank.mjs` · `decisionqueue.mjs` · `daily.mjs` · `doctor.mjs` · `weave.mjs` · `mcp.mjs` · `taskgraph.mjs` · `selftest.mjs` (הווקטורים-הקפואים) · `index.ts` (הכניסה).

**משפחות-חד-פעמיות (פורנזיקה לסבב — אל-תריץ בלי-סיבה, אל-תמחק: הן-הראיות):**
`probe-*.mjs` (לדוגמה: `probe-r265-deep.mjs`, `probe-r267-crosschain.mjs`, `probe-r267-blurt-fleet.mjs`) · `run-r2*.mjs` · `verify-*.mjs` · `*-r210.mjs` (עידן-הכרייה-הישן) · `r255-profile-sync.mjs` · `add-corpus-r264.mjs` · `scan-social-tmp.mjs` · `ci-act.mjs`/`ci-cycle.mjs` · `community-launch.mjs` · `pnl-public.mjs` · `intel-pack.mjs` · `proof-live.mjs` · `rc-probe.mjs` · `worklog-intel.mjs`.

**היררכיית-הstate (`mini-services/saos-engine/state/`):**
- ריבונות: `sovereign.json` · `events.jsonl` · `sovereign-events.jsonl` · `push-custody.json` · `custody-anchor.json` · `custodian.json` · `custodian-alerts.jsonl`
- כוח-מפתח: `army-custody.json` · `army.json` · `hive-custody.json` · `soldiers.json` · `fleet-roles.json` · `community.json`
- תפעול: `content-ops.json` · `order-ops.json` · `our-orders.json` · `hyper-ops.json` · `hive-ops.json` · `social.json` · `hive-social.json` · `hive-profiles.json` · `content-ops.json` · `cycle-run.json` · `daily-report.json`
- כלכלה/RC: `economics.json` · `payouts.json` · `rc-pool.json` · `rc-tank.json` · `market.json` · `convert-plan.json` · `convert-state.json`
- יומנים (append-only): `exec-log.jsonl` · `think-log.jsonl` · `outcomes.jsonl` · `predictions.jsonl` · `triggers.jsonl` · `ci-sessions.jsonl`
- סבבים (ראיות-פורנזיות): `r263-*.json` · `r264-*.json` · `r265-*.json` · `r267-crosschain.json` · `r267-blurt-fleet.json`
- בריאות: `selftest-last-run.json` (המקור-למבחן-הדוקטרינה) · `bridge-guard.json` · `cred-alarm.json` · `engine.pid`

## 3 · הסקריפטים-השעריים (`scripts/`)

`sovereign-push.sh` (הדחיפה-היחידה) · `github-guard.sh` (G1-G4) · `divergence-check.sh` · `sovereign-bootstrap.sh` (שחזור-מclone-טרי) · `sovereign-restore.sh` · `sovereign-runner.sh` · `conflict-forecast.sh` · `chain-anchor-probe.mjs` (עוגן-tip מול-השרשרת) · `chain-native-probe.mjs` · `doctrine-audit.mjs` (**חדש R267** — מאמת-את-הדוקטרינה-והאטלס) · `absorb-sheet-vault.mjs` · `cli-contract.mjs` · `dedup-audit.mjs` · `interaction-map.mjs` · `lock-hijack-probe.mjs` · `pat-audit.mjs` · `task-console.mjs` · `worklog-analytics.mjs` · `gitsafety-env.sh` · `github-secret-set.mjs` · `publish-github-packages.sh` · `dev-daemon.py` · `dev-keeper-hook.sh` · `saos-setup.mjs`.

## 4 · המסמכים (`docs/`)

`PEAK-OF-PROGRESS.md` (פסגת-ההתקדמות) · `STATE.md` · `PUBLISHING-SYSTEM.md` (מערכת-הפרסום, כולל-סעיף-8-האדוורסריאלי) · `PERSONAS.md` · `COMMUNITY.md` · `ANTI-SPAM-LAW.md` · `SPAMINATOR-DOCTRINE.md` · `SANDBOX-DISTRUST-LAW.md` · `CHAIN-NATIVE-SOVEREIGNTY.md` · `GITHUB-COMPLIANCE.md` · `OPERATOR-PAT-STEPS.md` · `ESTATE-INVENTORY.md` · `COMPETITIVE-INTELLIGENCE.md` · `AGENTCRAFT-INTEL.md` · `ADOPTIONS.md` · `POST-CAPABILITIES.md` · `builder-capabilities.md` · `measured/` · `evidence/`.

בשורש: `AGENTS.md` (חוק-הסוכן) · `SOVEREIGN-WRITER-LAW.md` · `SANDBOX`→docs · `PROPOSED-SINGLE-WRITER-LAW.md` · `TODO.md` · `worklog.md` (הזיכרון-הארוך; append-only) · **`agent/DOCTRINE.md` · `agent/ATLAS.md` (זה) · `agent/COLD-START.md`** · `agent/recovery-meta.json` (מטא-הכספת — כולל סיסמאות-עידן; נקרא-רק-דרך-git-show) · `agent/vault/` (הארכיונים-המוצפנים).

## 5 · המתכונים (ביצוע-מדויק, אפס-שינון-מחדש)

**פתיחת-סשן (הפרוטוקול המלא: `agent/COLD-START.md`):**
```bash
git fetch origin saos-cockpit && git reset --hard origin/saos-cockpit
bash scripts/divergence-check.sh                 # חייב 0/0
cd mini-services/saos-engine && bun selftest.mjs # חייב N/N PASS
node ../..//scripts/chain-anchor-probe.mjs       # עוגן-tip מול-השרשרת
bash scripts/doctrine-audit.mjs                  # חייב PASS (R267)
```

**דחיפה (היחידה-החוקית):** `bash scripts/sovereign-push.sh` — FF-only, github-guard, חתימת-גוף, custody-רשומה.

**פתיחת-כספת (המתכון-הכללי, כל-עידן — החוק: המטא-של-אותו-עידן מגדיר-נתיב+סיסמה):**
1. `git show <ref>:agent/recovery-meta.json` → keysZipFile/keysZipPass/keysZipSha256/keysZipInnerSha256 (**לעולם לא להדפיס**)
2. `git show <ref>:agent/vault/$keysZipFile` → הצב sha256(חוץ)==keysZipSha256
3. `openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -pass pass:$keysZipPass` → הצב sha256(פנים)==keysZipInnerSha256
4. `unzip` → `agent/keys/vault.json` → **זיכרון-בלבד**, finally-מחיקת-tmp (0700/0600)
5. עידנים: GEN-1 = commit `1c9f00d0` + `KEYS-ZIP-2026-09-10.zip.enc` · נוכחי = HEAD + `KEYS-ZIP-2026-10-08.zip.enc`
6. צורת-רשומה: per-chain (`keys.steem.*`) גוברת על flat (`keys.posting`) — `pickVaultKey` (hive.mjs), נעול-בselftest

**הרצת-ביקורת-עצמית:** `cd mini-services/saos-engine && bun selftest.mjs` → כותב `state/selftest-last-run.json` → המבחן-הדוקטריני ניזון-ממנו.

## 6 · הסדנים-החוקיות (רשימות-מקור-אמת בקוד — המבחן-מצליב-מולן)

| רשימה | מקור | תוכן |
|---|---|---|
| ARMY_ROSTER (13) | `vault-revival.mjs` | cashmachine, haran, israelnews, lsa, macrame, siq, tov, wic, wog, woq, hcsoldier4, hcsoldier5, hcsoldier6 |
| HIVE_ROSTER (9) | `hive.mjs` | cashmachine, haran, israelnews, lsa, macrame, siq, wic, wog, woq |
| כספת (15) | `agent/vault/…` | כל-ה-ARMY + headcorner + ynet (ynet: posting-anchor בלבד, נפסל-חוק-הגישה) |

## 7 · עובדות-השרשרות (נמדדו R265-R267)

**צמתים**: Steem `api.steemit.com` / `api.stem.fans` / `steemapi.boylikegirl.club` · Hive `api.hive.blog` / `api.openhive.network` / `api.deathwing.me` · Blurt `blurt-rpc.saboin.com` / `rpc.blurt.world`.

**מזהי-שרשרת**: Steem = 32×00 · Hive = `beeab0de`+אפסים · Blurt = `cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f` (מ-blurt-tx config.js; קדומת `BLT`).

**מעטפות-RPC**: rpcSteem מחזיר את result-החתוך (מערך); rpcHive מחזיר מעטפת-מלאה `{result}` — `unwrap()` חובה (חוק-R265: הטיוטה-הראשונה של הפרוב-מדדה-שקר).

**מתמטיקת-RC (Hive)**: `POST_RC_COST = 2,300,000,000` (hive.mjs) · `MIN_DELEGATION_RC = 1,607,605,799` · `DONOR_KEEP_MAX = 2,450,000,000` (rc-pool.mjs) · donorEligible: `max − MIN_DELEGATION ≥ DONOR_KEEP_MAX` · headcorner: max_rc 42.8B → 25 הרמות-רצפה.

**Blurt (R267)**: 11/12 גופות-קדם-פורק בכתר-מלא 4/4 (הכתר של-ynet לא בידינו; hcsoldier4/5/6 לא-קיימים-שם — נוצרו-2026). סטייק-דאסט אבל-ריבונות-מלאה; שידור-עתידי = chain-id מעוגן + מבני-עסקה זהים-ל-Steem עם חתימה-על-ה-id הזה.

## 8 · מה-אסור-לשכוח (הפורטל הקצר)

- אין force-push, אין דחיפה-עוקפת-שער, אין כתיבה ל-main.
- אין סוד-בstdout/בלוג/בגיט. הכספת היא מקור-המפתחות היחיד.
- אין trigger-ידני לצינורות-המנוע — הלוחות-זמנים שלו הם-החוק.
- כל-טענה-חדשה = מדידה+בקרת-שלילה. שקר-אחד-שנתפס מכפיל-אמון-פי-עשרה.

## 9 · חיבור-Hive — התשובה-הסגורה (פורנזיקה R268; לעולם-לא-לחפור-שוב)

השאלה-שחוזרת (המפעיל, R268): "Hive היה מחובר לפני-4-ימים — איך? אני-לא-התחברתי". התשובה נמדדה-מהשרשרת-ומהגיט ונחתמה:

1. **מי**: הבית-המקביל שלנו economy-engine[bot] ("Task 17 revenue wave — hive leg", mode real-votes) — קבלות-על-ענף-ה-main-המקביל (commit 8906af68 מ-02.10; r3/r4 מ-04.10: f9f54a72, 868378fe). לא-המפעיל, לא-גורם-חוץ. זו-הסיבה-שה-worklog-שלנו לא-ידע — שני-בתים, קבלות-ב-agent-receipts-על-main.
2. **באילו-מפתחות**: GEN-1 (commit 1c9f00d0) — מפתחות-הדור-הראשון, זהים-לסטים (אמת-המפעיל מ-R267 — מאומתת-חיה 9/9 posting+active, מנוטרת-כל-מחזור ב-`state/hive-custody.json`).
3. **מתי**: 30.09 פוסט-siq · 02.10 תשעה-פוסטים (לוקים 110426860–863, permlink-מהצורה saos-חשבון-20261002) · 03.10 ארבעה-פוסטים · **04.10 תשע-הצבעות-אמת (16:02) + שתיים (21:04) — כל-תשע-הגופות** · 07.10 האיבר-הריבוני-של-קו-הקוקפיט (R254: probe-vote-lsa מדוד-ב-active_votes + 4 פוסטים).
4. **גבולות-הכתר**: headcorner-על-Hive לא-מחובר (סובב; R267: 20 מועמדים × 4 תפקידים 0/4 — תחום-מפעיל) · tov-רוטציה · hcsoldier4/5/6-לא-קיימים-שם.
5. **המתכון** (קריאה-בלבד, אפס-מפתחות, ~2-דקות): `probe-r268-hive-forensics.mjs` + `probe-r268-hive-posts.mjs` (מ-engine) → `state/r268-hive-forensics.json` + `state/r268-hive-posts.json` · קבלות-בתים: git log --all -- agent/receipts/ · הדוח-המלא: `docs/measured/hive-connection-forensics-r268.md`.
