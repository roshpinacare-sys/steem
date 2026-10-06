import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const a = await db.agent.findMany({ select: { name: true, devKeyHex: true, ethAddress: true }, where: { status: "ACTIVE" } });
for (const x of a) console.log(x.name, x.devKeyHex ? "HAS-KEY" : "NO-KEY", x.ethAddress.slice(0, 10));
await db.$disconnect();
