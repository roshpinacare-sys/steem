
import * as mod from "/home/z/my-project/mini-services/money/intents.ts";
import fs from "node:fs";
const rec = mod.bootReconcileIntents();
const suppressed = mod.isSuppressed("reprice", "steem");
const suppressedOther = mod.isSuppressed("arm-buy", "hive");
const open = mod.openIntents().length;
const chain = mod.verifyIntentsBook();
fs.writeFileSync("/home/z/my-project/sovereign/proofs/repro-r208p/revival.json", JSON.stringify({ rec, suppressed, suppressedOther, open, chain }));
