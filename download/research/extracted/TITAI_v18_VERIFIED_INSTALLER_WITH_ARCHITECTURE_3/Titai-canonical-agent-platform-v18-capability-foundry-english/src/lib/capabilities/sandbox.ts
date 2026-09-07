import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sha256 } from "@/lib/durable/canonical-json";

export interface SandboxPolicy { level:"pure_in_process"|"isolated_worker"|"restricted_subprocess"|"os_sandbox"|"wasi"|"container"|"remote_disposable_worker"|"unsupported"; readPaths:string[]; writePaths:string[]; network:"deny_all"|"loopback_only"|"allowlist"; destinations:string[]; environmentAllowlist:string[]; secretNames:string[]; allowChildProcess:boolean; allowedExecutables:string[]; maxProcesses:number; timeoutMs:number; maxOutputBytes:number; maxMemoryBytes:number }
export interface SandboxFinding { code:string; severity:"critical"|"high"|"medium"; message:string }
export function inspectCapabilitySource(source:string,policy:SandboxPolicy):SandboxFinding[]{ const f:SandboxFinding[]=[]; if(policy.network==="deny_all"&&/node:(net|http|https|tls|dns)|fetch\s*\(/.test(source))f.push({code:"network_access",severity:"critical",message:"Network access is denied."}); if(!policy.allowChildProcess&&/node:child_process|child_process/.test(source))f.push({code:"child_process",severity:"critical",message:"Child process access is denied."}); if(/process\.env/.test(source)&&policy.environmentAllowlist.length===0)f.push({code:"environment_access",severity:"high",message:"Environment access is undeclared."}); if(/\.\.\//.test(source))f.push({code:"path_traversal",severity:"critical",message:"Path traversal token detected."}); return f; }
export async function executeRestrictedJavascript(options: {
  source: string;
  input: unknown;
  policy: SandboxPolicy;
}): Promise<{
  output: unknown;
  outputHash: string;
  durationMs: number;
  receipt: { sideEffect: boolean; hash: string };
}> {
  const findings = inspectCapabilitySource(options.source, options.policy);
  if (findings.some((finding) => finding.severity !== "medium")) {
    throw new Error(`sandbox_static_rejection:${findings.map((finding) => finding.code).join(",")}`);
  }
  const directory = mkdtempSync(join(tmpdir(), "titai-capability-"));
  const modulePath = join(directory, "capability.mjs");
  const runnerPath = join(directory, "runner.mjs");
  writeFileSync(modulePath, options.source);
  writeFileSync(
    runnerPath,
    `import { capabilityMain } from ${JSON.stringify(modulePath)};\n` +
      "const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);\n" +
      "const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));\n" +
      "const result=await capabilityMain(input); process.stdout.write(JSON.stringify(result));\n",
  );
  const started = Date.now();
  try {
    const output = await new Promise<unknown>((resolve, reject) => {
      const child = spawn(process.execPath, [runnerPath], {
        cwd: directory,
        env: { ...process.env, PATH: process.env.PATH ?? "" },
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
      let stdout = "";
      let stderr = "";
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error("sandbox_timeout")), options.policy.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        if (Buffer.byteLength(stdout) > options.policy.maxOutputBytes) fail(new Error("sandbox_output_limit"));
      });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", fail);
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code !== 0) reject(new Error(`sandbox_exit:${code}:${stderr.slice(0, 500)}`));
        else {
          try { resolve(JSON.parse(stdout)); }
          catch { reject(new Error("sandbox_invalid_json")); }
        }
      });
      child.stdin.end(JSON.stringify(options.input));
    });
    const outputHash = sha256(output);
    const sideEffect = Boolean((output as Record<string, unknown> | null)?.sideEffect);
    return {
      output,
      outputHash,
      durationMs: Date.now() - started,
      receipt: { sideEffect, hash: sha256({ outputHash, sideEffect }) },
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
