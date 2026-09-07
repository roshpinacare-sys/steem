import { createHash, verify } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const envelope = JSON.parse(readFileSync(join(root, "PACKAGE_MANIFEST.signed.json"), "utf8"));
function normalize(value){if(Array.isArray(value))return value.map(normalize);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalize(v)]));return value;}
const publicDer = Buffer.from(envelope.publicKeySpkiBase64, "base64");
const signatureValid = verify(null, Buffer.from(JSON.stringify(normalize(envelope.manifest))), { key: publicDer, format: "der", type: "spki" }, Buffer.from(envelope.signatureBase64, "base64"));
const mismatches=[];
for(const file of envelope.manifest.files){const path=join(root,file.path);if(!existsSync(path)){mismatches.push({path:file.path,error:"missing"});continue;}const hash=createHash("sha256").update(readFileSync(path)).digest("hex");const bytes=statSync(path).size;if(hash!==file.sha256||bytes!==file.bytes)mismatches.push({path:file.path,expected:file.sha256,actual:hash,expectedBytes:file.bytes,bytes});}
const passed=signatureValid&&mismatches.length===0;
console.log(JSON.stringify({status:passed?"passed":"failed",signatureValid,files:envelope.manifest.files.length,mismatches},null,2));
if(!passed)process.exitCode=2;
