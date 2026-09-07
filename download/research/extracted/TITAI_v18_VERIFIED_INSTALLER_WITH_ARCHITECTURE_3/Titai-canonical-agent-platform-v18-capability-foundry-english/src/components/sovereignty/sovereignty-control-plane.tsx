import {
  BatteryCharging,
  Boxes,
  Cable,
  CircleAlert,
  CloudOff,
  Cpu,
  Database,
  FileKey2,
  HardDriveDownload,
  KeyRound,
  Network,
  PackageCheck,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import type { SovereigntyControlPlaneSnapshot } from "@/lib/sovereignty/control-plane";

function Gate({ label, state, detail }: { label: string; state: "pass" | "block" | "unknown"; detail: string }) {
  return (
    <li className="sovereignty-gate" data-state={state}>
      <span>{state === "pass" ? "PASS" : state === "block" ? "BLOCK" : "UNKNOWN"}</span>
      <div><strong>{label}</strong><p>{detail}</p></div>
    </li>
  );
}

function Dimension({ label, value }: { label: string; value: number }) {
  return (
    <li>
      <div><span>{label}</span><strong>{value}/100</strong></div>
      <progress value={value} max={100} aria-label={`${label} ${value} out of 100`} />
    </li>
  );
}

export function SovereigntyControlPlane({ snapshot }: { snapshot: SovereigntyControlPlaneSnapshot }) {
  const vector = snapshot.assessment.vector;
  return (
    <>
      <PageHeader
        title="Sovereignty control plane"
        subtitle="Where intelligence runs, where data lives, what leaves the machine, and what remains dependent."
      />
      <section className="sovereignty-hero" aria-labelledby="sovereignty-level">
        <div>
          <span className="sovereignty-kicker"><ShieldCheck /> Controlled independence</span>
          <h2 id="sovereignty-level">{snapshot.assessment.level.replaceAll("_", " ")}</h2>
          <p>{snapshot.assessment.explanation}</p>
        </div>
        <dl>
          <div><dt>Operating mode</dt><dd>{snapshot.operatingMode.replaceAll("_", " ")}</dd></div>
          <div><dt>Mandatory external dependencies</dt><dd>{snapshot.dependencies.mandatoryExternal}</dd></div>
          <div><dt>Blocked network attempts</dt><dd>{snapshot.network.blocked}</dd></div>
          <div><dt>Release blockers</dt><dd>{snapshot.blockers.length}</dd></div>
        </dl>
      </section>

      <div className="sovereignty-grid">
        <section className="sovereignty-panel" aria-labelledby="dimensions-title">
          <header><Cpu /><div><h3 id="dimensions-title">Sovereignty vector</h3><p>Fatal weaknesses are evaluated before any average score.</p></div></header>
          <ol className="sovereignty-dimensions">
            <Dimension label="Compute" value={vector.compute} />
            <Dimension label="Model" value={vector.model} />
            <Dimension label="Data" value={vector.data} />
            <Dimension label="Memory" value={vector.memory} />
            <Dimension label="Identity" value={vector.identity} />
            <Dimension label="Tools" value={vector.tools} />
            <Dimension label="Network" value={vector.network} />
            <Dimension label="Updates" value={vector.updates} />
            <Dimension label="Supply chain" value={vector.supplyChain} />
            <Dimension label="Recovery" value={vector.recovery} />
            <Dimension label="Energy" value={vector.energy} />
            <Dimension label="Governance" value={vector.governance} />
          </ol>
        </section>

        <section className="sovereignty-panel" aria-labelledby="dependency-title">
          <header><Boxes /><div><h3 id="dependency-title">Dependency posture</h3><p>Remote services are adapters, not hidden foundations.</p></div></header>
          <div className="sovereignty-stat-grid">
            <article><Database /><span>Local authoritative</span><strong>{snapshot.dependencies.localAuthoritative}</strong></article>
            <article><Cable /><span>Remote optional</span><strong>{snapshot.dependencies.remoteOptional}</strong></article>
            <article><CloudOff /><span>Remote required</span><strong>{snapshot.dependencies.mandatoryExternal}</strong></article>
            <article><Network /><span>Unexpected network</span><strong>{snapshot.network.unexpected}</strong></article>
          </div>
          <p className="sovereignty-truth"><CircleAlert /> A zero count is evidence only when the outbound audit ran. Silence is not automatically proof of isolation.</p>
        </section>
      </div>

      <section className="sovereignty-panel" aria-labelledby="vertical-slices-title">
        <header><PackageCheck /><div><h3 id="vertical-slices-title">Mandatory sovereign vertical slices</h3><p>Each gate is derived from evidence. Unknown remains blocking.</p></div></header>
        <ol className="sovereignty-gates">
          <Gate label="Zero-key local workflow" state={snapshot.readiness.zeroKeyWorkflow} detail="Local identity, governed memory, local tool, evidence, verification, encrypted backup, and restore." />
          <Gate label="Signed air-gap handoff" state={snapshot.readiness.signedHandoff} detail="Bounded tenant/workspace scope, replay rejection, revocable trust, signed result, and import verification." />
          <Gate label="Signed offline update" state={snapshot.readiness.signedUpdate} detail="Compatibility, integrity, atomic apply, evidence binding, and downgrade rejection." />
          <Gate label="Offline rollback" state={snapshot.readiness.updateRollback} detail="Previous source and authoritative data can be restored after failure or explicit rollback." />
          <Gate label="Real migration rehearsal" state={snapshot.readiness.realMigrationRehearsal} detail="A signed update applies an actual schema migration, validates it, and restores the prior database." />
          <Gate label="Clean local restore" state={snapshot.readiness.cleanRestore} detail="Encrypted authoritative state can be restored without the original vendor." />
          <Gate label="Local retrieval fallback" state={snapshot.readiness.localRetrievalFallback} detail="Governed lexical retrieval works without a remote embedding service and its index is reconstructable." />
          <Gate label="Portable separated key custody" state={snapshot.readiness.portableKeyCustody} detail="Purpose-separated encrypted keys support rotation, revocation, expiry, and scope binding." />
          <Gate label="OS or hardware key custody" state={snapshot.readiness.operatingSystemKeyCustody} detail="A second custody backend must be proven on the target operating system or hardware." />
          <Gate label="Clean offline installation" state={snapshot.readiness.cleanOfflineInstall} detail="A disposable clean machine must install and start without npm, GitHub, model-hub, or registry access." />
          <Gate label="Process-level network evidence" state={snapshot.readiness.processNetworkEvidence} detail="OS-level observations must identify attempted destinations and prove deny-by-default operation." />
          <Gate label="Real local model benchmark" state={snapshot.readiness.realLocalModelBenchmark} detail="Deterministic execution is not a substitute for a hash-verified generative model benchmark." />
          <Gate label="Browser and accessibility" state={snapshot.readiness.browserAccessibility} detail="Real browser E2E, keyboard, focus, responsive, offline, and accessibility evidence is required." />
          <Gate label="Real multi-node execution" state={snapshot.readiness.multiNodeExecution} detail="At least two execution identities must complete signed, tenant-scoped work and failure recovery." />
          <Gate label="Full test-suite clean exit" state={snapshot.readiness.fullSuiteCleanExit} detail="The authoritative isolated suite must pass and terminate without leaked handles or child processes." />
          <Gate label="Measured hardware and energy" state={snapshot.readiness.hardwareEnergyMeasurement} detail="Hardware-grounded energy evidence is required before energy can control routing." />
          <Gate label="Hash-bound independent verifier" state={snapshot.readiness.hashBoundIndependentVerifier} detail="A separate verifier must evaluate the final frozen archive hash without builder-private state." />
        </ol>
      </section>

      <div className="sovereignty-grid sovereignty-grid--three">
        <section className="sovereignty-mini"><FileKey2 /><div><strong>Key custody</strong><p>Installation, tenant, workspace, data, backup, and signing keys use separated contexts.</p></div></section>
        <section className="sovereignty-mini"><HardDriveDownload /><div><strong>Offline evolution</strong><p>Signed updates can dry-run, apply, validate, fail atomically, and roll back.</p></div></section>
        <section className="sovereignty-mini"><ServerCog /><div><strong>Node placement</strong><p>Hardware feasibility, tenant trust, data locality, load, and energy precede utility scoring.</p></div></section>
        <section className="sovereignty-mini"><KeyRound /><div><strong>Local authority</strong><p>Memory and model output can inform decisions but cannot grant capabilities or tenant scope.</p></div></section>
        <section className="sovereignty-mini"><BatteryCharging /><div><strong>Energy evidence</strong><p>Scheduling can defer, downsize, relocate, or fail closed under declared budgets.</p></div></section>
        <section className="sovereignty-mini"><TriangleAlert /><div><strong>Current blockers</strong><p>{snapshot.blockers.length ? snapshot.blockers.join(", ").replaceAll("_", " ") : "No declared blocker."}</p></div></section>
      </div>
    </>
  );
}
