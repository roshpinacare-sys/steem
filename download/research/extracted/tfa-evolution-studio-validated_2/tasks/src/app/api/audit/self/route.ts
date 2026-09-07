import { NextResponse } from "next/server";
import { runSelfAudit, formatReport } from "@/lib/audit/self-audit";

export const runtime = "nodejs";

export async function GET() {
  const report = runSelfAudit(process.cwd());
  return NextResponse.json({
    clean: report.clean,
    scannedFiles: report.scannedFiles,
    packageVersion: report.packageVersion,
    findings: report.findings,
    formatted: formatReport(report),
    ranAt: report.ranAt,
  }, { status: report.clean ? 200 : 422 });
}
