# G13 custody-restoration kit (2026-10-18) — chain-judged, fail-closed

Measured root cause: the reboot wiped gitignored runtime caches (.secrets/*);
the posting rails stood down. This kit rebuilds them FROM GIT, zero operator action.

1. g13-unseal-master.mjs — recovers the recovery-3 era pass from PRE-R-VAULTPASS-1
   git history (recovery-meta: "material persists in pre-migration git history"),
   opens the pinned MASTER bundle (inner sha256 MUST equal recovery-meta pin),
   censuses WIF slots. Verdict-only stdout, pass env-only.
2. g13-build-army-cache.mjs — chain-judges EVERY role WIF of the MASTER bundle
   against LIVE authorities; writes .secrets/army-keys.json (0600) with ONLY
   live-matched posting identities.
3. g13-fleet-restore.mjs — for accounts whose posting authority points to
   stranded keys: APPENDS the custody posting pubkey (threshold 1, owner/active/
   memo null=untouched), signed by the LIVE owner WIF, verified post-broadcast
   via get_accounts. Reversible by owner account_update2.

Measured outcome 2026-10-18: headcorner + 9 army accounts posting-LIVE;
tov/wog/hcsoldier5 honestly blocked (gen2-era active authority, pass locked in
an Actions secret — pending bundle or owner). First live posts: headcorner
3860e411… (13:54:45Z), cashmachine c8437a17… (14:14:39Z).

LAWS: chain is the only judge; fail-closed verdicts; zero material in stdout,
git, or logs; caches 0600 gitignored.
