import { NextResponse } from "next/server";
import {
  runBatch,
  type BatchUnit,
  type BatchGroup,
} from "@/lib/batch/batch-coordinator";

export const runtime = "nodejs";

interface BatchRequest {
  units: { id: string; groupId: string; safeForParallel: boolean; payload: Record<string, unknown> }[];
  groups?: { id: string; units: string[]; dependsOn?: string[] }[];
  concurrencyLimit?: number;
}

export async function POST(req: Request) {
  const body = (await req.json()) as BatchRequest;
  if (!body?.units?.length) {
    return NextResponse.json({ error: "units required" }, { status: 400 });
  }

  const units: BatchUnit<Record<string, unknown>>[] = body.units.map((u) => ({
    id: u.id,
    groupId: u.groupId,
    safeForParallel: u.safeForParallel,
    payload: u.payload,
  }));

  const groups: BatchGroup[] = body.groups ?? [
    { id: "default", units: units.map((u) => u.id) },
  ];

  const report = await runBatch(
    units,
    groups,
    async (unit) => ({ echo: unit.payload, ranAt: new Date().toISOString() }),
    { concurrencyLimit: body.concurrencyLimit ?? 4 }
  );

  return NextResponse.json(report);
}
