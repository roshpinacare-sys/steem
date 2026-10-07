# DEDUP-REPORT r244 — body-map of the sovereign body

Generated: 2026-10-07T16:50:44.816Z · hub: roshpinacare-sys/Domain
Totals: 58 workflows — LIVE 46 · TOOLS 11 · FAILING 1 · DISABLED 0

## Role clusters (duplicate surface)
- **market** (market/economy ops) — 12 products ⚠ multi-product: arb-mesh(live,runs=9), dex-core(live,runs=9), dex-grid(live,runs=1), dex-router(live,runs=9), dex-xc(live,runs=9), earn-audit-cron(live,runs=17), econ-desk(live,runs=4), economy-engine(live,runs=4), fill-ledger-cron(live,runs=17), ladder-refresh(live,runs=3), market-grid-cron(live,runs=17), treasury-route(live,runs=2)
- **heartbeat** (keep-alive cadence) — 10 products ⚠ multi-product: canary(live,runs=5), cloud-heart(dispatch-tool,runs=0), cloud-pulse(live,runs=1), dex-beat(live,runs=5), moment-watch(live,runs=17), public-pulse(live,runs=1), sovereign-tick-cron(live,runs=17), tick-keeper(dispatch-tool,runs=0), watchdog(live,runs=9), weave-heart(live,runs=9)
- **content** (content & audience) — 9 products ⚠ multi-product: audience-analyst(dispatch-tool,runs=0), content-campaign(live,runs=2), content-reviewer(live,runs=1), content-truth-wave(dispatch-tool,runs=0), human-cadence(live,runs=7), recruit(live,runs=1), self-audience(live,runs=2), social-audit(dispatch-tool,runs=0), soldiers-curate(live,runs=2)
- **anchor** (chain anchoring / custody witness) — 6 products ⚠ multi-product: anchor-execute(live,runs=9), proof-pipeline(live,runs=1), seal-adopt(dispatch-tool,runs=0), vault-transfer(dispatch-tool,runs=0), weave-anchor-lines(live,runs=33), weave-anchor-ping(live,runs=8)
- **audit** (verification & audit) — 6 products ⚠ multi-product: fleet-census-cron(live,runs=1), gitleaks-secret-scan(dispatch-tool,runs=0), org-gitleaks(failing,runs=2), org-selftests(live,runs=1), sovereign-selftests(live,runs=1), twin-audit(live,runs=1)
- **other** (unclassified) — 5 products ⚠ multi-product: daily-claim(live,runs=1), daily-digest(live,runs=1), foundry-mesh-tests(live,runs=1), weave-ecosystem(live,runs=1), workflow-yaml-guard(dispatch-tool,runs=0)
- **mirror** (cross-repo mirroring) — 4 products ⚠ multi-product: dex-mirror(live,runs=9), mirror-from-console(live,runs=13), tri-bridge(live,runs=2), weave-mirror(live,runs=8)
- **engine** (sovereign engine cycle) — 3 products ⚠ multi-product: agent-verify(live,runs=17), grid-trigger-twin(live,runs=17), saos-act(live,runs=5)
- **web** (web publishing) — 3 products ⚠ multi-product: bootstrap-pages(dispatch-tool,runs=0), web-publish(live,runs=25), pages-build-deployment(dispatch-tool,runs=0)

## Products
- [LIVE] anchor-execute — cluster:anchor · created:2026-09-28 · runs:9 ok:9 fail:0 · last:2026-10-07T14:02 success
- [LIVE] proof-pipeline — cluster:anchor · created:2026-09-28 · runs:1 ok:1 fail:0 · last:2026-10-07T04:53 success
- [DISPATCH-TOOL] seal-adopt — cluster:anchor · created:2026-09-21 · runs:0 ok:0 fail:0
- [DISPATCH-TOOL] vault-transfer — cluster:anchor · created:2026-10-03 · runs:0 ok:0 fail:0
- [LIVE] weave-anchor-lines — cluster:anchor · created:2026-09-21 · runs:33 ok:33 fail:0 · last:2026-10-07T16:32 success
- [LIVE] weave-anchor-ping — cluster:anchor · created:2026-10-03 · runs:8 ok:2 fail:6 · last:2026-10-06T20:19 failure
- [LIVE] fleet-census-cron — cluster:audit · created:2026-10-03 · runs:1 ok:1 fail:0 · last:2026-10-07T02:28 success
- [DISPATCH-TOOL] gitleaks-secret-scan — cluster:audit · created:2026-09-28 · runs:0 ok:0 fail:0
- [FAILING] org-gitleaks — cluster:audit · created:2026-09-30 · runs:2 ok:0 fail:2 · last:2026-10-06T19:55 failure
- [LIVE] org-selftests — cluster:audit · created:2026-09-30 · runs:1 ok:1 fail:0 · last:2026-10-07T03:38 success
- [LIVE] sovereign-selftests — cluster:audit · created:2026-09-28 · runs:1 ok:1 fail:0 · last:2026-10-07T06:43 success
- [LIVE] twin-audit — cluster:audit · created:2026-10-02 · runs:1 ok:1 fail:0 · last:2026-10-07T06:37 success
- [DISPATCH-TOOL] audience-analyst — cluster:content · created:2026-10-02 · runs:0 ok:0 fail:0
- [LIVE] content-campaign — cluster:content · created:2026-09-28 · runs:2 ok:2 fail:0 · last:2026-10-07T13:26 success
- [LIVE] content-reviewer — cluster:content · created:2026-10-02 · runs:1 ok:1 fail:0 · last:2026-10-07T05:20 success
- [DISPATCH-TOOL] content-truth-wave — cluster:content · created:2026-10-02 · runs:0 ok:0 fail:0
- [LIVE] human-cadence — cluster:content · created:2026-10-04 · runs:7 ok:7 fail:0 · last:2026-10-06T19:22 success
- [LIVE] recruit — cluster:content · created:2026-10-02 · runs:1 ok:1 fail:0 · last:2026-10-07T04:57 success
- [LIVE] self-audience — cluster:content · created:2026-09-29 · runs:2 ok:2 fail:0 · last:2026-10-07T14:47 success
- [DISPATCH-TOOL] social-audit — cluster:content · created:2026-10-04 · runs:0 ok:0 fail:0
- [LIVE] soldiers-curate — cluster:content · created:2026-10-02 · runs:2 ok:2 fail:0 · last:2026-10-07T06:54 success
- [LIVE] agent-verify — cluster:engine · created:2026-09-20 · runs:17 ok:17 fail:0 · last:2026-10-07T16:30 success
- [LIVE] grid-trigger-twin — cluster:engine · created:2026-09-28 · runs:17 ok:17 fail:0 · last:2026-10-07T10:21 success
- [LIVE] saos-act — cluster:engine · created:2026-10-07 · runs:5 ok:2 fail:3 · last:2026-10-07T16:24 success
- [LIVE] canary — cluster:heartbeat · created:2026-10-06 · runs:5 ok:5 fail:0 · last:2026-10-07T13:56 success
- [DISPATCH-TOOL] cloud-heart — cluster:heartbeat · created:2026-09-21 · runs:0 ok:0 fail:0
- [LIVE] cloud-pulse — cluster:heartbeat · created:2026-09-27 · runs:1 ok:1 fail:0 · last:2026-10-07T00:55 success
- [LIVE] dex-beat — cluster:heartbeat · created:2026-09-21 · runs:5 ok:3 fail:2 · last:2026-10-07T02:01 success
- [LIVE] moment-watch — cluster:heartbeat · created:2026-09-20 · runs:17 ok:17 fail:0 · last:2026-10-07T09:28 success
- [LIVE] public-pulse — cluster:heartbeat · created:2026-10-02 · runs:1 ok:1 fail:0 · last:2026-10-07T06:24 success
- [LIVE] sovereign-tick-cron — cluster:heartbeat · created:2026-10-03 · runs:17 ok:17 fail:0 · last:2026-10-07T10:28 success
- [DISPATCH-TOOL] tick-keeper — cluster:heartbeat · created:2026-10-04 · runs:0 ok:0 fail:0
- [LIVE] watchdog — cluster:heartbeat · created:2026-09-27 · runs:9 ok:9 fail:0 · last:2026-10-07T15:34 success
- [LIVE] weave-heart — cluster:heartbeat · created:2026-09-21 · runs:9 ok:9 fail:0 · last:2026-10-07T16:32 success
- [LIVE] arb-mesh — cluster:market · created:2026-10-04 · runs:9 ok:9 fail:0 · last:2026-10-07T14:21 success
- [LIVE] dex-core — cluster:market · created:2026-10-04 · runs:9 ok:9 fail:0 · last:2026-10-07T11:55 success
- [LIVE] dex-grid — cluster:market · created:2026-09-21 · runs:1 ok:1 fail:0 · last:2026-10-07T03:57 success
- [LIVE] dex-router — cluster:market · created:2026-10-04 · runs:9 ok:9 fail:0 · last:2026-10-07T11:37 success
- [LIVE] dex-xc — cluster:market · created:2026-10-04 · runs:9 ok:9 fail:0 · last:2026-10-07T13:07 success
- [LIVE] earn-audit-cron — cluster:market · created:2026-10-04 · runs:17 ok:17 fail:0 · last:2026-10-07T08:25 success
- [LIVE] econ-desk — cluster:market · created:2026-10-02 · runs:4 ok:4 fail:0 · last:2026-10-06T22:29 success
- [LIVE] economy-engine — cluster:market · created:2026-10-02 · runs:4 ok:4 fail:0 · last:2026-10-06T18:39 success
- [LIVE] fill-ledger-cron — cluster:market · created:2026-10-03 · runs:17 ok:17 fail:0 · last:2026-10-07T08:57 success
- [LIVE] ladder-refresh — cluster:market · created:2026-10-02 · runs:3 ok:3 fail:0 · last:2026-10-06T23:47 success
- [LIVE] market-grid-cron — cluster:market · created:2026-10-03 · runs:17 ok:17 fail:0 · last:2026-10-07T09:33 success
- [LIVE] treasury-route — cluster:market · created:2026-09-30 · runs:2 ok:2 fail:0 · last:2026-10-07T16:39 success
- [LIVE] dex-mirror — cluster:mirror · created:2026-09-20 · runs:9 ok:9 fail:0 · last:2026-10-07T13:05 success
- [LIVE] mirror-from-console — cluster:mirror · created:2026-10-02 · runs:13 ok:13 fail:0 · last:2026-10-07T13:26 success
- [LIVE] tri-bridge — cluster:mirror · created:2026-09-30 · runs:2 ok:2 fail:0 · last:2026-10-07T15:34 success
- [LIVE] weave-mirror — cluster:mirror · created:2026-09-20 · runs:8 ok:8 fail:0 · last:2026-10-06T20:00 success
- [LIVE] daily-claim — cluster:other · created:2026-09-29 · runs:1 ok:1 fail:0 · last:2026-10-07T02:49 success
- [LIVE] daily-digest — cluster:other · created:2026-09-28 · runs:1 ok:1 fail:0 · last:2026-10-07T01:14 success
- [LIVE] foundry-mesh-tests — cluster:other · created:2026-09-28 · runs:1 ok:1 fail:0 · last:2026-10-06T20:51 success
- [LIVE] weave-ecosystem — cluster:other · created:2026-09-21 · runs:1 ok:1 fail:0 · last:2026-10-07T06:52 success
- [DISPATCH-TOOL] workflow-yaml-guard — cluster:other · created:2026-10-04 · runs:0 ok:0 fail:0
- [DISPATCH-TOOL] bootstrap-pages — cluster:web · created:2026-09-20 · runs:0 ok:0 fail:0
- [DISPATCH-TOOL] pages-build-deployment — cluster:web · created:2026-09-20 · runs:0 ok:0 fail:0
- [LIVE] web-publish — cluster:web · created:2026-09-21 · runs:25 ok:25 fail:0 · last:2026-10-07T07:56 success

## Law-repo internal
- engine modules: 36 · scripts: 9 · runtime tests: 3
- probe family: scripts/chain-anchor-probe.mjs vs scripts/chain-native-probe.mjs vs engine/rc-probe.mjs vs engine/proof-live.mjs — one probe product, four surfaces (documented, not merged: each answers a different chain question)
- download/ chaos&fuzz tools vs tests/ runtime-build — different jobs (engine chaos vs environment), no merge
