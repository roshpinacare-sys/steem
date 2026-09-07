import { NextRequest, NextResponse } from "next/server";
import {
  listConnectors,
  createConnector,
  maskSensitiveConfig,
  CONNECTOR_CATALOG,
} from "@/lib/integrations/connector-registry";
import type { ConnectorKind, ConnectorPermission } from "@/lib/integrations/connector-types";
import type { Integration } from "@/lib/types";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") ?? undefined;
  try {
    const connectors = listConnectors(projectId).map(maskSensitiveConfig);
    return NextResponse.json({ connectors, catalog: CONNECTOR_CATALOG });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      kind: ConnectorKind;
      projectId: string;
      label: string;
      config: Record<string, string>;
      permissions?: ConnectorPermission[];
    };
    if (!body.kind || !body.projectId || !body.label) {
      return NextResponse.json({ error: "kind, projectId, and label are required" }, { status: 400 });
    }
    const instance = createConnector({
      name: body.label,
      kind: body.kind as Integration["kind"],
      config: body.config ?? {},
      enabled: true,
    });
    return NextResponse.json({ connector: maskSensitiveConfig(instance) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
