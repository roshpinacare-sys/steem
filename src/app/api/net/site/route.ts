import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * /api/net/site — THE CHAIN-HOSTED WEBSITE GATEWAY.
 *
 * The page itself is NOT stored here. It lives on the Steem blockchain as a
 * content-addressed SAOS-KV document (custom_json id=saos_kv, key
 * saos://www/index.html), published by agent/net_site.cjs after a mandatory
 * sha256 read-back from public chain history. This route only serves the
 * VERIFIED page with provenance headers. If the chain document ever changes,
 * the sha256 in X-SAOS-Sha256 changes with it — anyone can re-verify against
 * any Steem node in the world.
 */
export async function GET() {
  try {
    const raw = await readFile(path.join(process.cwd(), "agent", "net_site_cache.json"), "utf8");
    const site = JSON.parse(raw) as {
      html?: string;
      sha256?: string;
      size?: number;
      parts?: number;
      headBlock?: number | null;
      at?: string;
      verified?: boolean;
      txids?: (string | null)[];
    };
    if (!site?.html || !site.verified) {
      return new NextResponse(notYet(), { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new NextResponse(site.html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-SAOS-Source": "steem-blockchain",
        "X-SAOS-Key": "saos://www/index.html",
        "X-SAOS-Sha256": site.sha256 ?? "",
        "X-SAOS-Size": String(site.size ?? site.html.length),
        "X-SAOS-Parts": String(site.parts ?? 1),
        "X-SAOS-Block": String(site.headBlock ?? ""),
        "X-SAOS-Published": site.at ?? "",
        "X-SAOS-Txids": (site.txids ?? []).filter(Boolean).join(","),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse(notYet(), { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

function notYet(): string {
  return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>SAOS-Web</title></head>
<body style="background:#09090b;color:#a1a1aa;font-family:system-ui;padding:48px;text-align:center">
<h1 style="color:#e4e4e7">האתר עדיין לא פורסם לשרשרת</h1>
<p>הרץ את <code style="color:#fbbf24">site</code> מנוף-הפיקוד — הפרסום כולל roundtrip sha256 כפוי מההיסטוריה.</p></body></html>`;
}
