import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const nk = await db.networkKey.findUnique({ where: { id: "weave-network" } });
console.log("networkKey:", nk ? { address: nk.address.slice(0,10), hasKey: !!nk.devKeyHex } : null);
await db.$disconnect();
