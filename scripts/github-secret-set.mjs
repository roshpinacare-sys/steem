import nacl from "tweetnacl";
import { blake2b } from "@noble/hashes/blake2.js";
import * as fs from "node:fs";

const TOKEN = fs.readFileSync("upload/pat.env", "utf8").trim();
const r = await fetch("https://api.github.com/repos/roshpinacare-sys/saos-runtime/actions/secrets/public-key", { headers: { Authorization: "Bearer " + TOKEN, Accept: "application/vnd.github+json" } });
const pk = await r.json();
const key = new Uint8Array(Buffer.from(pk.key, "base64"));
const eph = nacl.box.keyPair();
const msg = new Uint8Array(Buffer.from(TOKEN, "utf8"));
const nonce = blake2b(new Uint8Array(Buffer.concat([Buffer.from(eph.publicKey), Buffer.from(key)])), { dkLen: 24 });
const box = nacl.box(msg, nonce, key, eph.secretKey);
const b64 = Buffer.concat([Buffer.from(eph.publicKey), Buffer.from(box)]).toString("base64");
const res = await fetch("https://api.github.com/repos/roshpinacare-sys/saos-runtime/actions/secrets/GH_PAT", {
  method: "PUT",
  headers: { Authorization: "Bearer " + TOKEN, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
  body: JSON.stringify({ encrypted_value: b64, key_id: pk.key_id }),
});
console.log("secret GH_PAT set:", res.status === 201 || res.status === 204 ? "OK (" + res.status + ")" : res.status + " " + JSON.stringify(await res.json()).slice(0, 140));
