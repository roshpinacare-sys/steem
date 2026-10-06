#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// SAOS WEB · web-probe — אבחון חד-פעמי: למה comment נדחה בעוד
// custom_json של אותו מפתח מצליח?
//
// מבחנים (הכל מדווח, כלום לא נכתב לריפו):
//   0. המפתח הציבורי הנגזר מה-WIF — אמת לא-רגישה (מזהה בלבד)
//   A. custom_json בסמכות posting — קבוצת ביקורת (כמו קווי העוגן)
//   B. comment מינימלי בלבד
//   C. comment + comment_options (כמו הייצור)
//   D. comment עם גוף המניפסט האמיתי (14KB)
// ─────────────────────────────────────────────────────────────────────

import steem from "steem";
import { steemBroadcast } from "@/lib/weave/graphene";
// GrapheneOperation מיובא מהחבילה עצמה — graphene.ts מגדיר אותו מקומית ולא מייצא
import type { GrapheneOperation } from "steem";

const WIF = (process.env.WEAVE_STEEM_WIF || "").trim();
const ACCOUNT = "cashmachine";
const TAG = "saosweb";
const TS = Date.now().toString(36);
const DRY = !WIF;

// 0. זהות המפתח (נגזר-ציבורי בלבד — ה-WIF לעולם לא מודפס)
try {
  const pub = steem.auth.wifToPublic(WIF || "5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3");
  console.log(`[probe-0] wifToPublic = ${pub} ${DRY ? "(דמה — אין WIF)" : ""}`);
} catch (e) {
  console.log(`[probe-0] wifToPublic נכשל: ${String(e).slice(0, 120)}`);
}

async function attempt(label: string, ops: GrapheneOperation[]): Promise<void> {
  if (DRY) {
    console.log(`[${label}] DRY — אין WIF`);
    return;
  }
  const r = await steemBroadcast(ops, WIF);
  console.log(`[${label}] ${r.txid ? `SUCCESS txid=${r.txid}` : `FAIL ${r.note ?? "no-txid"}`}`);
}

// A. custom_json — קבוצת ביקורת
await attempt(
  "A",
  [["custom_json", {
    required_auths: [],
    required_posting_auths: [ACCOUNT],
    id: "saos.web.probe.v1",
    json: JSON.stringify({ probe: "A", ts: TS }),
  }]]
);

// B. comment מינימלי
await attempt(
  "B",
  [["comment", {
    parent_author: "",
    parent_permlink: TAG,
    author: ACCOUNT,
    permlink: `saosweb-probe-${TS}-b`,
    title: "SAOS WEB probe B",
    body: "probe B",
    json_metadata: JSON.stringify({ app: "saos-web/1", tags: [TAG] }),
  }]]
);

// C. comment + comment_options
await attempt(
  "C",
  [
    ["comment", {
      parent_author: "",
      parent_permlink: TAG,
      author: ACCOUNT,
      permlink: `saosweb-probe-${TS}-c`,
      title: "SAOS WEB probe C",
      body: "probe C",
      json_metadata: JSON.stringify({ app: "saos-web/1", tags: [TAG] }),
    }],
    ["comment_options", {
      author: ACCOUNT,
      permlink: `saosweb-probe-${TS}-c`,
      max_accepted_payout: "0.000 SBD",
      percent_steem_dollars: 0,
      allow_votes: false,
      allow_curation_rewards: false,
      allow_replies: false,
      extensions: [],
    }],
  ]
);

// D. comment עם גוף 14KB (כמו המניפסט בייצור)
{
  const body = JSON.stringify({ probe: "D", pad: "x".repeat(14_000), ts: TS });
  await attempt(
    "D",
    [["comment", {
      parent_author: "",
      parent_permlink: TAG,
      author: ACCOUNT,
      permlink: `saosweb-probe-${TS}-d`,
      title: "SAOS WEB probe D",
      body,
      json_metadata: JSON.stringify({ app: "saos-web/1", tags: [TAG] }),
    }]]
  );
}

console.log("[probe] הסתיים");
