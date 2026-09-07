import { NextResponse } from 'next/server';
export async function POST(request, { params }) {
  const { missionId } = await params;
  const expressUrl = process.env.ECOS_EXPRESS_URL || 'http://localhost:3000';
  const targetUrl = `${expressUrl}/api/v1/approvals/${missionId}/resolve`;
  const idempotencyKey = request.headers.get('idempotency-key');
  let bodyText = '';
  try { bodyText = await request.text(); } catch (_) {}
  const headers = { 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  try {
    const expressRes = await fetch(targetUrl, { method: 'POST', headers, body: bodyText || undefined });
    const resBody = await expressRes.text();
    const responseHeaders = new Headers();
    const ct = expressRes.headers.get('content-type');
    if (ct) responseHeaders.set('Content-Type', ct);
    responseHeaders.set('X-Forwarded-By', 'nextjs-proxy');
    return new Response(resBody, { status: expressRes.status, headers: responseHeaders });
  } catch (err) {
    return NextResponse.json({ error: 'Proxy failed', details: err.message }, { status: 502 });
  }
}
