// GET  /api/agents — רשימת סוכנים (asc לפי createdAt) עם attCount (groupBy)
// POST /api/agents — רישום סוכן חדש: זהות EVM נוצרת בשרת.
// ⚠ devKeyHex לעולם לא חוזר בשום response — רק AgentDTO.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AGENT_ROLES, jsonError, readJsonBody, toAgentDTO } from "@/lib/weave/api";
import { generateIdentity } from "@/lib/weave/evm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [agents, grouped] = await Promise.all([
      db.agent.findMany({ orderBy: { createdAt: "asc" } }),
      db.attestation.groupBy({ by: ["agentId"], _count: { agentId: true } }),
    ]);
    const counts = new Map(grouped.map((g) => [g.agentId, g._count.agentId]));
    return NextResponse.json({
      ok: true,
      agents: agents.map((agent) => toAgentDTO(agent, counts.get(agent.id) ?? 0)),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const roleInput = typeof body.role === "string" ? body.role.trim() : "";

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "שם הסוכן ריק — נדרש שם ייחודי" },
        { status: 400 }
      );
    }

    // ברירת מחדל SCOUT כשלא סופקה תפקיד; תפקיד שסופק ואינו חוקי → דחייה
    let role = "SCOUT";
    if (roleInput.length > 0) {
      if (!AGENT_ROLES.includes(roleInput as (typeof AGENT_ROLES)[number])) {
        return NextResponse.json(
          {
            ok: false,
            error: `תפקיד לא חוקי (${roleInput}) — המותרים: ${AGENT_ROLES.join(", ")}`,
          },
          { status: 400 }
        );
      }
      role = roleInput;
    }

    const existing = await db.agent.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { ok: false, error: `סוכן בשם "${name}" כבר רשום ברשת` },
        { status: 409 }
      );
    }

    const identity = generateIdentity();
    const agent = await db.agent.create({
      data: {
        name,
        role,
        ethAddress: identity.address,
        pubKeyHex: identity.pubKeyHex,
        devKeyHex: identity.devKeyHex, // נשמר ב-DB בלבד (DEVNET) — לעולם לא חוזר החוצה
        status: "ACTIVE",
      },
    });

    return NextResponse.json(
      { ok: true, agent: toAgentDTO(agent, 0) },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
