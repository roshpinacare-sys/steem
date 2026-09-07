import { cpus, freemem, totalmem, platform, arch, hostname, loadavg } from "node:os";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, process.env.TITAI_HARDWARE_EVIDENCE ?? "docs/canonical/evidence/v16/hardware/hardware-profile.json");
function readNumber(path, divisor = 1) { try { return Number(readFileSync(path, "utf8").trim()) / divisor; } catch { return undefined; } }
function thermalEvidence() {
  const base = "/sys/class/thermal";
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((name) => name.startsWith("thermal_zone")).map((name) => {
    const path = `${base}/${name}`;
    return { zone: name, type: (() => { try { return readFileSync(`${path}/type`, "utf8").trim(); } catch { return "unknown"; } })(), celsius: readNumber(`${path}/temp`, 1000) };
  });
}
function raplEvidence() {
  const base = "/sys/class/powercap";
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((name) => name.startsWith("intel-rapl")).map((name) => ({ domain: name, energyMicrojoules: readNumber(`${base}/${name}/energy_uj`) })).filter((item) => item.energyMicrojoules !== undefined);
}
const cpu = cpus();
const evidence = {
  format: "titai-v16-hardware-evidence",
  version: 1,
  generatedAt: new Date().toISOString(),
  host: { hostname: hostname(), platform: platform(), architecture: arch(), logicalCores: cpu.length, cpuModel: cpu[0]?.model ?? "unknown", cpuSpeedMhz: cpu[0]?.speed ?? 0 },
  memory: { totalBytes: totalmem(), freeBytes: freemem() },
  loadAverage: loadavg(),
  thermal: thermalEvidence(),
  energy: { method: raplEvidence().length ? "linux_rapl_snapshot" : "unavailable", confidence: raplEvidence().length ? "measured_snapshot_only" : "unknown", domains: raplEvidence(), wattHoursMeasured: null, explanation: raplEvidence().length ? "RAPL counters are available, but workload delta measurement requires a bounded command run." : "No supported hardware energy counter was exposed to this environment." },
  limitations: ["This profile does not represent the user's mini-PC unless collected on that hardware.", "No energy claim is made when a hardware counter is unavailable."],
};
const canonical = JSON.stringify(evidence);
evidence.sha256 = createHash("sha256").update(canonical).digest("hex");
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ output, energyMethod: evidence.energy.method, cores: evidence.host.logicalCores, totalMemoryBytes: evidence.memory.totalBytes }));
