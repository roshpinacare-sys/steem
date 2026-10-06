// אבחון זמני — מדפיס את תוצאת deepScanChain ישירות (בלי שרת-dev)
import { deepScanChain } from "@/lib/web/netstore";

const t0 = Date.now();
const deep = await deepScanChain("steem", { entries: 700 });
const meta = deep.meta;
const entry = deep.byHash.get("8a9bff7a7e83346e8e05d47d23010d6b86225d29abb5e547ef361bebece52273");
console.log("meta:", JSON.stringify(meta));
console.log("entry found:", !!entry);
if (entry) {
  console.log("manifest:", entry.manifest ? `block ${entry.manifest.block}` : "—");
  console.log("chunks:", [...entry.chunks.keys()].sort((a, b) => a - b));
}
console.log(`took ${Date.now() - t0}ms`);
