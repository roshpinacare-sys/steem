/**
 * t59b.vectors.mjs — Task 2-b (door-to-market) · contract vectors for the
 * MCP door's market-wiring round:
 *   §A door telemetry pure law (typed bucket, closed verdict set, bounded)
 *   §B counter persistence (atomic tmp+rename, ≤8KB, fail-open load, temp dirs)
 *   §C the ≤2KB /status telemetry snapshot
 *   §D hive.regime — the 6th read-only tool (present, args-refused, honest)
 *   §E catalog market-data-feed fulfillment v1→v2 (self-serve markers, no v1)
 *   §F promo catalog footer — ONE door line (endpoint shape + tool count + key path)
 *
 * Offline: zero network, zero keys material (no real HMAC keys anywhere —
 * the door-key laws are already covered in selftest §55 with fake salts).
 * Persistence vectors run in node:os tmpdir with a unique suffix, cleaned
 * up in a finally block. Run: bun t59runner.mjs t59b.vectors.mjs
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DOOR_VERDICTS, DOOR_TOOLS_MAX,
  doorCountersInit, doorHitLaw,
  doorCountersBound, persistDoorCounters, loadDoorCounters, doorCountersPath, doorTelemetrySnapshot,
  MCP_TOOLS, mcpToolArgsJudge, feedToolResult,
} from "./feed.mjs";
import { SKUS } from "./catalog.mjs";
import { catalogFooter } from "./promo.mjs";

export async function run({ eq, ok }) {
  const NOW = "2026-10-04T00:00:00.000Z";
  const NOWMS = Date.parse(NOW);

  /* §A · door counters — typed structure + the pure law */
  eq("t59b-a init-shape", doorCountersInit(), { hits: 0, byTool: {}, byVerdict: {}, firstAt: null, lastAt: null });

  eq("t59b-a verdict-set-closed", DOOR_VERDICTS, ["initialize", "tools-list", "tools-call", "tool-name", "ping", "unauthorized", "bad-frame", "rate-limited"]);

  const b0 = doorCountersInit();
  const r1 = doorHitLaw({ bucket: b0, now: NOWMS, verdict: "ping" });
  eq("t59b-a ping-first-hit", r1.bucket, { hits: 1, byTool: {}, byVerdict: { ping: 1 }, firstAt: NOW, lastAt: NOW });
  ok("t59b-a law-is-pure", JSON.stringify(b0) === JSON.stringify(doorCountersInit()));

  eq("t59b-a unknown-verdict-refused", doorHitLaw({ bucket: b0, now: NOWMS, verdict: "magic" }).ok, false);
  eq("t59b-a unknown-verdict-unchanged", doorHitLaw({ bucket: b0, now: NOWMS, verdict: "magic" }).bucket.hits, 0);
  eq("t59b-a bad-now-refused", doorHitLaw({ bucket: b0, now: "not-a-date", verdict: "ping" }).ok, false);

  const b2 = doorHitLaw({ bucket: r1.bucket, now: NOWMS + 1, verdict: "tools-call", tool: "fills.recent" }).bucket;
  eq("t59b-a tools-call-bytool", b2.byTool, { "fills.recent": 1 });
  eq("t59b-a first-preserved", b2.firstAt, NOW);
  eq("t59b-a hits-compose", b2.hits, 2);

  const b3 = doorHitLaw({ bucket: b2, now: NOWMS + 2, verdict: "tools-call" }).bucket;
  eq("t59b-a unnamed-call-unknown-bucket", b3.byTool, { "fills.recent": 1, _unknown: 1 });

  const fatSeed = { hits: 32, byTool: {}, byVerdict: { "tools-call": 32 }, firstAt: NOW, lastAt: NOW };
  for (let i = 0; i < 32; i++) fatSeed.byTool[`junk${i}`] = 1;
  fatSeed.byTool["hot.tool"] = 5;
  const fat = doorHitLaw({ bucket: fatSeed, now: NOWMS, verdict: "tools-call", tool: "fresh.tool" }).bucket;
  ok("t59b-a bytool-bounded", Object.keys(fat.byTool).length <= DOOR_TOOLS_MAX);
  ok("t59b-a bytool-busiest-kept", fat.byTool["hot.tool"] === 5); // the busiest name survives the saturation trim

  const all = DOOR_VERDICTS.reduce((b, v) => doorHitLaw({ bucket: b, now: NOWMS, verdict: v }).bucket, doorCountersInit());
  eq("t59b-a all-verdicts-count", all.hits, DOOR_VERDICTS.length);

  /* §B · persistence — temp dir, atomic mirror, fail-open load */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "saos-t59b-"));
  try {
    const doc = doorHitLaw({ bucket: doorCountersInit(), now: NOWMS, verdict: "tools-call", tool: "market.snapshot" }).bucket;
    const pr = await persistDoorCounters(doc, { dir: tmp });
    ok("t59b-b persist-ok", pr?.ok === true && pr.bytes > 0);
    eq("t59b-b roundtrip", loadDoorCounters({ dir: tmp }), { hits: 1, byTool: { "market.snapshot": 1 }, byVerdict: { "tools-call": 1 }, firstAt: NOW, lastAt: NOW });

    ok("t59b-b load-missing-failopen", JSON.stringify(loadDoorCounters({ dir: path.join(tmp, "nope") })) === JSON.stringify(doorCountersInit()));

    fs.writeFileSync(doorCountersPath(tmp), "{corrupt!!");
    ok("t59b-b load-corrupt-failopen", JSON.stringify(loadDoorCounters({ dir: tmp })) === JSON.stringify(doorCountersInit()));

    const longName = "t".repeat(100);
    fs.writeFileSync(doorCountersPath(tmp), JSON.stringify({ hits: 3, byVerdict: { ping: 2, junk: 99 }, byTool: { [longName]: 2 }, firstAt: NOW, lastAt: NOW }));
    const lj = loadDoorCounters({ dir: tmp });
    ok("t59b-b load-sanitize-verdicts", lj.byVerdict.ping === 2 && lj.byVerdict.junk === undefined);
    ok("t59b-b load-sanitize-toolkey", lj.byTool[longName.slice(0, 40)] === 2 && lj.byTool[longName] === undefined && lj.hits === 3);

    const fatDoc = { hits: 9000, byTool: {}, byVerdict: { "tools-call": 9000 }, firstAt: NOW, lastAt: NOW };
    for (let i = 0; i < 300; i++) fatDoc.byTool[`venue-tool-${i}-${"y".repeat(40)}`] = i + 1;
    const pr2 = await persistDoorCounters(fatDoc, { dir: tmp });
    ok("t59b-b persist-bounded-8kb", pr2?.ok === true && pr2.bytes <= 8192);
    ok("t59b-b persist-atomic-no-tmp-leftover", fs.readdirSync(tmp).every((f) => !f.includes(".tmp.")));
    const lb = loadDoorCounters({ dir: tmp });
    ok("t59b-b bound-load-shape", typeof lb.hits === "number" && Object.keys(lb.byTool).length <= DOOR_TOOLS_MAX && Object.keys(lb.byVerdict).every((v) => DOOR_VERDICTS.includes(v)));

    ok("t59b-b bound-shrinks-bytool", Object.keys(doorCountersBound(fatDoc)).length <= DOOR_TOOLS_MAX);
    ok("t59b-b persist-creates-nested-dir", (await persistDoorCounters(doc, { dir: path.join(tmp, "nested", "deeper") })).ok === true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* §C · the ≤2KB /status passthrough snapshot */
  const nasty = { hits: 123456, byTool: {}, byVerdict: { ping: 5, "tools-call": 100, wizard: 77 }, firstAt: NOW, lastAt: NOW };
  for (let i = 0; i < 100; i++) nasty.byTool[`t${i}-${"z".repeat(60)}`] = i + 1;
  const snap = doorTelemetrySnapshot(nasty);
  ok("t59b-c snapshot-under-2kb", Buffer.byteLength(JSON.stringify(snap)) <= 2048);
  ok("t59b-c snapshot-toolcap", Object.keys(snap.byTool).length <= 12);
  ok("t59b-c snapshot-verdicts-closed", Object.keys(snap.byVerdict).every((v) => DOOR_VERDICTS.includes(v)) && snap.byVerdict.wizard === undefined);
  ok("t59b-c snapshot-garbage-safe", doorTelemetrySnapshot(null).hits === 0 && doorTelemetrySnapshot("x").hits === 0);

  /* §D · hive.regime — the 6th tool */
  eq("t59b-d tools-count-six", MCP_TOOLS.length, 6);
  eq("t59b-d hive-regime-in-table", MCP_TOOLS.find((t) => t.name === "hive.regime")?.inputSchema?.type, "object");
  eq("t59b-d hive-regime-args-refused", mcpToolArgsJudge("hive.regime", { sneaky: 1 }).ok, false);
  eq("t59b-d hive-regime-noargs-ok", mcpToolArgsJudge("hive.regime", {}).ok, true);

  const hr = await feedToolResult("hive.regime", {}, { account: "headcorner" });
  ok("t59b-d hive-regime-served", hr.isError === false && hr.data.pair === "HBD:HIVE");
  ok("t59b-d hive-regime-honest-measured-flag", hr.data.measured === true || hr.data.measured === false);
  ok("t59b-d hive-regime-cred-note", typeof hr.data.credentialNote === "string" && hr.data.credentialNote.includes("blocked-no-credential"));
  eq("t59b-d hive-regime-junk-args-iserror", (await feedToolResult("hive.regime", { junk: 1 })).isError, true);

  /* §E · catalog market-data-feed — v2 self-serve text, v1 remnant gone */
  const sku = SKUS.find((s) => s.id === "market-data-feed");
  const ftext = `${sku.fulfillment} ${sku.what}`;
  ok("t59b-e catalog-v2-markers", ["POST /mcp", "x-saos-feed", "initialize", "tools/list", "tools/call", "HMAC"].every((m) => ftext.includes(m)));
  ok("t59b-e catalog-six-tools-named", ["market.snapshot", "router.verdict", "catalog.list", "fills.recent", "payouts.clock", "hive.regime"].every((t) => sku.fulfillment.includes(t)));
  ok("t59b-e catalog-no-v1-remnant", !ftext.includes("תגובת-זיכרון") && !ftext.includes("תגובה-על-פוסט"));
  ok("t59b-e catalog-key-path-ttl", sku.fulfillment.includes("SAOS-CATALOG:market-data-feed") && sku.fulfillment.includes("7"));

  /* §F · promo footer — the ONE door line */
  const footer = catalogFooter("headcorner", [{ id: "market-data-feed", priceSbd: 1, per: "week", what: "x" }]).join("\n");
  ok("t59b-f promo-door-line-markers", ["POST /mcp", "x-saos-feed", "SAOS-CATALOG:market-data-feed", "initialize", "hive.regime"].every((m) => footer.includes(m)));
  ok("t59b-f promo-toolcount-rides-table", footer.includes(`${MCP_TOOLS.length} כלי-קריאה`));
  ok("t59b-f promo-order-law-kept", footer.includes("SAOS-CATALOG:<sku>"));
}
