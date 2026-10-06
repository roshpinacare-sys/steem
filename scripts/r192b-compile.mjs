#!/usr/bin/env node
// r192-b — compile the W1 DEX core (contracts/w1/*.sol) with solc 0.8.37.
// Output: contracts/w1/artifacts/<Contract>.json {abi, bytecode}
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const solc = require("solc");

const ROOT = "/home/z/my-project";
const DIR = path.join(ROOT, "contracts", "w1");
const OUT = path.join(DIR, "artifacts");

const files = ["WrappedToken.sol", "Pair.sol", "Router.sol", "Sim.sol"];
const sources = {};
for (const f of files) sources[f] = { content: fs.readFileSync(path.join(DIR, f), "utf8") };

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === "error");
  for (const e of output.errors) console.error(`[solc][${e.severity}]`, e.formattedMessage.trim());
  if (fatal.length > 0) process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
let count = 0;
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, art] of Object.entries(contracts)) {
    const abi = art.abi;
    const bytecode = "0x" + art.evm.bytecode.object;
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ contract: name, file, abi, bytecode }, null, 1) + "\n");
    console.log(`[compile] ${name} (${file}): ${abi.length} ABI entries · bytecode ${(bytecode.length - 2) / 2} bytes`);
    count++;
  }
}
console.log(`[compile] OK — ${count} contract artifacts in ${path.relative(ROOT, OUT)}`);
