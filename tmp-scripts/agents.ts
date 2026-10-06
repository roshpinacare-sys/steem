import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const a = await db.agent.findMany({ select: { name: true, role: true, status: true }, orderBy: { createdAt: "asc" } });
console.log(JSON.stringify(a));
await db.$disconnect();
