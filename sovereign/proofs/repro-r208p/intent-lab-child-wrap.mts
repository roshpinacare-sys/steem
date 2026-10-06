
import * as mod from "/home/z/my-project/mini-services/money/intents.ts";
import fs from "node:fs";
const id = mod.appendIntent({ action: "reprice", target: "steem", tag: null, reason: "מעבדה: ירי-מדומה לפני-מוות" });
fs.writeFileSync("/home/z/my-project/sovereign/proofs/repro-r208p/victim.fired", id);
await new Promise((r) => setTimeout(r, 10_000));
mod.closeIntent(id, "REPRICE", true);
fs.writeFileSync("/home/z/my-project/sovereign/proofs/repro-r208p/victim.closed", id);
