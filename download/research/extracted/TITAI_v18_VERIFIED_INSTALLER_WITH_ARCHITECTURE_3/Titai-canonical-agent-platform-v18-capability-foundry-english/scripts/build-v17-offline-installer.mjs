import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { platform, arch } from "node:os";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const output = resolve(process.env.TITAI_V17_INSTALLER_OUTPUT ?? "/mnt/data/Titai-v17-offline-installer-linux-x64.tar.gz");
const staging = resolve(process.env.TITAI_V17_INSTALLER_STAGING ?? "/mnt/data/titai-v17-installer-staging");
const nextBuild = resolve(root, ".next/BUILD_ID");
if (!existsSync(nextBuild)) throw new Error("production_build_missing_run_npm_build_first");
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
mkdirSync(join(staging, "runtime"), { recursive: true });
mkdirSync(join(staging, "application"), { recursive: true });
mkdirSync(join(staging, "installer"), { recursive: true });
cpSync(process.execPath, join(staging, "runtime/node"));
chmodSync(join(staging, "runtime/node"), 0o755);
cpSync(resolve(root, ".next"), join(staging, "application/.next"), { recursive: true, dereference: true });
cpSync(resolve(root, "node_modules"), join(staging, "application/node_modules"), { recursive: true, dereference: true });
cpSync(resolve(root, "package.json"), join(staging, "application/package.json"));
if (existsSync(resolve(root, "public"))) cpSync(resolve(root, "public"), join(staging, "application/public"), { recursive: true });
if (existsSync(resolve(root, "drizzle"))) cpSync(resolve(root, "drizzle"), join(staging, "application/drizzle"), { recursive: true });

writeFileSync(join(staging, "installer/migrate.mjs"), `import { DatabaseSync } from 'node:sqlite';\nimport { mkdirSync, readFileSync, readdirSync } from 'node:fs';\nimport { dirname, resolve } from 'node:path';\nimport { createHash } from 'node:crypto';\nconst dbPath=resolve(process.env.DATABASE_PATH??'./data/titai.db');mkdirSync(dirname(dbPath),{recursive:true});const db=new DatabaseSync(dbPath);db.exec('PRAGMA foreign_keys=ON');db.exec('CREATE TABLE IF NOT EXISTS titai_canonical_migrations (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)');const dir=resolve(process.cwd(),'drizzle');for(const name of readdirSync(dir).filter(n=>/^\\d+.*\\.sql$/.test(n)).sort()){const sql=readFileSync(resolve(dir,name),'utf8');const hash=createHash('sha256').update(sql).digest('hex');const row=db.prepare('SELECT sha256 FROM titai_canonical_migrations WHERE id=?').get(name);if(row){if(row.sha256!==hash)throw new Error('migration_drift:'+name);continue;}db.exec('BEGIN IMMEDIATE');try{db.exec(sql);db.prepare('INSERT INTO titai_canonical_migrations(id,sha256,applied_at) VALUES(?,?,?)').run(name,hash,new Date().toISOString());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}db.close();console.log(JSON.stringify({status:'passed',databasePath:dbPath}));\n`);
writeFileSync(join(staging, "installer/start.mjs"), `import { spawn } from 'node:child_process';import { resolve } from 'node:path';const root=resolve(import.meta.dirname,'..');const node=resolve(root,'runtime/node');const app=resolve(root,'application');const next=resolve(app,'node_modules/next/dist/bin/next');const child=spawn(node,[next,'start','--hostname',process.env.HOSTNAME??'127.0.0.1','--port',process.env.PORT??'3210'],{cwd:app,stdio:'inherit',env:{...process.env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'}});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exit(code??1));\n`);
writeFileSync(join(staging, "installer/README.txt"), "TITAI v17 offline installer proof bundle. Verify installer-manifest.signed.json before execution. Model weights and secrets are not included.\n");

function walk(directory) {
  const result = [];
  for (const name of readdirSync(directory).sort()) {
    const full = join(directory, name);
    const stat = statSync(full);
    if (stat.isDirectory()) result.push(...walk(full));
    else if (stat.isFile()) result.push(full);
  }
  return result;
}
function sha(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
const component = (rel) => rel.startsWith("runtime/") ? "runtime" : rel.startsWith("application/drizzle/") ? "migration" : rel.startsWith("application/public/") ? "public" : rel.startsWith("installer/") ? "installer" : "application";
const releaseHash = process.env.TITAI_RELEASE_SHA256 ?? createHash("sha256").update(JSON.stringify({ version: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version, lock: sha(resolve(root, "package-lock.json")) })).digest("hex");
const files = walk(staging).filter((path) => !path.endsWith("installer-manifest.signed.json")).map((path) => {
  const stat = statSync(path); const rel = relative(staging, path).replaceAll("\\", "/");
  return { path: rel, sha256: sha(path), bytes: stat.size, mode: stat.mode & 0o7777, component: component(rel) };
});
const signingKeyPath = process.env.TITAI_INSTALLER_SIGNING_KEY;
let privateKey, publicKey, signingMode;
if (signingKeyPath) {
  privateKey = createPrivateKey(readFileSync(signingKeyPath)); publicKey = (await import("node:crypto")).createPublicKey(privateKey); signingMode = "trusted_external";
} else {
  const pair = generateKeyPairSync("ed25519"); privateKey = pair.privateKey; publicKey = pair.publicKey; signingMode = "development_ephemeral";
}
const manifest = {
  format: "titai-v17-offline-installer", version: 1, release: "v17-physical-pilot-closure", releaseSha256: releaseHash,
  createdAt: new Date().toISOString(), platform: platform(), architecture: arch(), nodeVersion: process.version, signingMode, files,
  startup: { command: ["runtime/node", "installer/start.mjs"], loopbackHost: "127.0.0.1", defaultPort: 3210 },
  capabilities: { publicRegistryRequiredAtInstall: false, cloudIdentityRequired: false, commercialApiKeyRequired: false, modelWeightsIncluded: false },
  limitations: ["This platform-specific bundle does not include model weights or browser artifacts.", signingMode === "development_ephemeral" ? "Manifest uses an ephemeral development signing identity and is not trusted for pilot promotion." : ""].filter(Boolean),
};
const canonical = JSON.stringify(manifest, Object.keys(manifest).sort());
// Use a recursive canonicalizer to match the application verifier.
function normalize(value){if(Array.isArray(value))return value.map(normalize);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalize(v)]));return value;}
const payload = Buffer.from(JSON.stringify(normalize(manifest)));
const publicDer = publicKey.export({ format: "der", type: "spki" });
const envelope = { manifest, signatureAlgorithm: "Ed25519", signatureBase64: sign(null, payload, privateKey).toString("base64"), publicKeySpkiBase64: publicDer.toString("base64"), keyId: createHash("sha256").update(publicDer).digest("hex").slice(0,24) };
writeFileSync(join(staging, "installer-manifest.signed.json"), `${JSON.stringify(envelope, null, 2)}\n`);
mkdirSync(dirname(output), { recursive: true });
rmSync(output, { force: true });
execFileSync("tar", ["-czf", output, "-C", staging, "."], { stdio: "inherit" });
const result = { output, sha256: sha(output), bytes: statSync(output).size, files: files.length, signingMode, releaseSha256: releaseHash, staging };
writeFileSync(`${output}.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
