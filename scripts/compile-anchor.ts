// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · קומפילציה מקומית של WeaveAnchorRegistry (שער EVM-1 — הכנה)
//
// ריצה: bun scripts/compile-anchor.ts
// מקמפל את המקור מ-src/lib/weave/anchor.ts עם solc-js (אמיתי, לא ידני),
// מריץ קומפילציה כפולה להוכחת דטרמיניזם, מצליב keccak מול ethers,
// וכותב artifact ל-src/lib/weave/artifacts/WeaveAnchorRegistry.json.
//
// תווית אמת: הקומפילציה REAL; הפריסה בשרשרת — עדיין NOT-YET (EVM-1).
// ─────────────────────────────────────────────────────────────────────

import * as fs from "node:fs";
import * as path from "node:path";
import * as solc from "solc";
import { keccak256, getBytes, toUtf8Bytes } from "ethers";
import { ANCHOR_REGISTRY_SOURCE } from "../src/lib/weave/anchor";

const EVM_VERSION = "cancun";
const OPTIMIZER = { enabled: true, runs: 200 };
const OUTPUT_SELECTION = {
  "*": {
    "*": [
      "abi",
      "evm.bytecode.object",
      "evm.deployedBytecode.object",
      "evm.gasEstimates",
    ],
  },
};

interface SolcError {
  severity: string;
  formattedMessage?: string;
  message: string;
}

interface SolcContract {
  abi: unknown[];
  evm: {
    bytecode: { object: string };
    deployedBytecode: { object: string };
    gasEstimates?: {
      creation?: { codeDepositCost?: string };
    };
  };
}

function buildInput(source: string): string {
  return JSON.stringify({
    language: "Solidity",
    sources: { "WeaveAnchorRegistry.sol": { content: source } },
    settings: {
      optimizer: OPTIMIZER,
      evmVersion: EVM_VERSION,
      outputSelection: OUTPUT_SELECTION,
    },
  });
}

function compileOnce(source: string): SolcContract {
  const raw = solc.compile(buildInput(source));
  const output = JSON.parse(typeof raw === "string" ? raw : String(raw));
  const errors = (output.errors ?? []) as SolcError[];
  const fatal = errors.filter((e) => e.severity === "error");
  if (fatal.length > 0) {
    throw new Error(
      "solc errors:\n" + fatal.map((e) => e.formattedMessage ?? e.message).join("\n")
    );
  }
  const contract = output.contracts?.["WeaveAnchorRegistry.sol"]?.["WeaveAnchorRegistry"];
  if (!contract || !contract.evm?.bytecode?.object) {
    throw new Error("solc: לא הופק bytecode — הפלט לא תקין");
  }
  return contract as SolcContract;
}

const first = compileOnce(ANCHOR_REGISTRY_SOURCE);
const second = compileOnce(ANCHOR_REGISTRY_SOURCE); // הוכחת דטרמיניזם — פעמיים
const deterministicRecompileMatch =
  first.evm.bytecode.object === second.evm.bytecode.object;
if (!deterministicRecompileMatch) {
  throw new Error("קומפילציה לא דטרמיניסטית — מסרב לכתוב artifact");
}

const bytecode = "0x" + first.evm.bytecode.object;
const deployedBytecode = "0x" + first.evm.deployedBytecode.object;
const bytecodeKeccak = keccak256(getBytes(bytecode));
const deployedBytecodeKeccak = keccak256(getBytes(deployedBytecode));
// בדיקה מבנית אמיתית: קוד ה-runtime מוטמע בתוך קוד הפריסה (כמו בכל חוזה EVM)
const runtimeEmbedded = bytecode.includes(deployedBytecode.slice(2));
if (!runtimeEmbedded) {
  throw new Error("runtime code אינו מוטמע בקוד הפריסה — פלט חשוד, מסרב לכתוב artifact");
}

const codeDepositGas = Number(
  first.evm.gasEstimates?.creation?.codeDepositCost ?? NaN
);

const artifact = {
  contract: "WeaveAnchorRegistry",
  compiler: `solc ${solc.version()} (solc-js)`,
  evmVersion: EVM_VERSION,
  optimizer: OPTIMIZER,
  compiledAt: new Date().toISOString(),
  deterministicRecompileMatch,
  runtimeEmbeddedInCreation: runtimeEmbedded,
  source: ANCHOR_REGISTRY_SOURCE,
  sourceKeccak: keccak256(toUtf8Bytes(ANCHOR_REGISTRY_SOURCE)),
  abi: first.abi,
  bytecode,
  bytecodeKeccak,
  deployedBytecode,
  deployedBytecodeKeccak,
  codeDepositGas: Number.isFinite(codeDepositGas) ? codeDepositGas : null,
  gate: "EVM-1",
};

const outDir = path.join(process.cwd(), "src", "lib", "weave", "artifacts");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "WeaveAnchorRegistry.json");
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");

console.log("✔ קומפילציה:", artifact.compiler);
console.log("✔ bytecode keccak256 (ethers):", bytecodeKeccak);
console.log("✔ אומדן codeDeposit gas:", artifact.codeDepositGas);
console.log("✔ דטרמיניסטי (קומפילציה כפולה):", deterministicRecompileMatch);
console.log("✔ runtime מוטמע בפריסה:", runtimeEmbedded);
console.log("→", outPath);
