import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const proofs = await db.attestation.findMany({ where: { claimType: { in: ["PROOF", "PROOF-REGISTRY"] } }, select: { seq: true, claimType: true, claim: true, entryHash: true }, orderBy: { seq: "asc" } });
console.log("PROOF attestations in DB:", proofs.length);
for (const p of proofs.slice(0, 3)) console.log(`#${p.seq}`, p.claimType, p.claim.slice(0, 60));
if (proofs.length) console.log("last:", `#${proofs[proofs.length-1].seq}`, proofs[proofs.length-1].claimType, proofs[proofs.length-1].claim.slice(0, 80));
const registrar = await db.agent.findUnique({ where: { name: "weave-proof-registrar" }, select: { ethAddress: true } });
console.log("registrar:", registrar?.ethAddress.slice(0, 12));
await db.$disconnect();
