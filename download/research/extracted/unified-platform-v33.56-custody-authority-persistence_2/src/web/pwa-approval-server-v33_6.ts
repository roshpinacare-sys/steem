import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { PushApprovalCard } from '../product/chat-mission.js';
import {
  PilotSessionRegistryV33_6,
  PilotTelemetryLedgerV33_6,
  type PilotEvidenceClassV33_6,
  type PilotSessionGrantV33_6,
} from '../product/human-pilot-readiness-v33_6.js';
import type { SignedEnvelope } from '../contracts/crypto.js';

export interface PwaApprovalServerOptionsV33_6 {
  readonly assetsRoot: string;
  readonly card: PushApprovalCard;
  readonly sessions: PilotSessionRegistryV33_6;
  readonly telemetry: PilotTelemetryLedgerV33_6;
  readonly now?: () => Date;
  readonly allowedOrigin?: string;
}

export function createPwaApprovalServerV33_6(options: PwaApprovalServerOptionsV33_6) {
  const now = options.now ?? (() => new Date());
  return createServer(async (request, response) => {
    try {
      securityHeaders(response);
      enforceOrigin(request, options.allowedOrigin);
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) return serveAsset(options.assetsRoot, url.pathname, response);
      if (request.method === 'GET' && url.pathname === '/api/v33.6/health') return json(response, 200, { status:'ok', version:'33.6', mode:'local-human-pilot-readiness', productionPromotion:'blocked', externalEffectsExecuted:0 });
      if (request.method === 'POST' && url.pathname === '/api/v33.6/session') {
        const body = await readJson(request);
        if (!isRecord(body)) throw new HttpError(400, 'session_body_invalid');
        const evidenceClass = String(body.evidenceClass ?? 'SIMULATED') as PilotEvidenceClassV33_6;
        if (evidenceClass !== 'SIMULATED') throw new HttpError(403, 'human_pilot_requires_independent_observer_workflow');
        const csrfToken = randomBytes(24).toString('base64url');
        const issuedAt = now().toISOString();
        const expiresAt = new Date(now().getTime() + 15 * 60_000).toISOString();
        const issued = options.sessions.issue({
          tenantId:String(body.tenantId ?? ''), userId:String(body.userId ?? ''), deviceId:String(body.deviceId ?? ''), card:options.card,
          csrfToken, evidenceClass,
          ...(body.participantId === undefined ? {} : {participantId:String(body.participantId)}),
          consentRecorded:body.consentRecorded === true, issuedAt, expiresAt,
        }, now());
        options.telemetry.append({eventId:randomBytes(16).toString('hex'),sessionId:issued.record.grant.payload.sessionId,tenantId:issued.record.grant.payload.tenantId,eventType:'SESSION_STARTED',occurredAt:issuedAt,userStepIncrement:1,evidenceClass});
        response.setHeader('set-cookie', cookie('pilot_session', Buffer.from(JSON.stringify(issued.record.grant)).toString('base64url'), 900));
        return json(response, 201, { csrfToken, sessionId:issued.record.grant.payload.sessionId, cardId:options.card.cardId, evidenceClass, externalEffectsExecuted:0 });
      }
      const session = parseSessionCookie(request);
      const grant = session.payload;
      if (request.method === 'GET' && url.pathname === '/api/v33.6/card') {
        options.sessions.get(grant.sessionId, now());
        options.telemetry.append({eventId:randomBytes(16).toString('hex'),sessionId:grant.sessionId,tenantId:grant.tenantId,eventType:'CARD_VIEWED',occurredAt:now().toISOString(),userStepIncrement:0,evidenceClass:grant.evidenceClass});
        return json(response, 200, { card:options.card, pilot:{evidenceClass:grant.evidenceClass, humanEvidenceAccepted:grant.evidenceClass==='HUMAN_OBSERVED'&&grant.consentRecorded}, externalEffectsExecuted:0 });
      }
      if (request.method === 'POST' && url.pathname === '/api/v33.6/explain') {
        requireCsrf(request);
        options.sessions.authorize({session,csrfToken:String(request.headers['x-csrf-token'] ?? ''),tenantId:grant.tenantId,userId:grant.userId,deviceId:grant.deviceId,cardId:grant.cardId,acceptedAt:now().toISOString()});
        options.telemetry.append({eventId:randomBytes(16).toString('hex'),sessionId:grant.sessionId,tenantId:grant.tenantId,eventType:'EXPLANATION_OPENED',occurredAt:now().toISOString(),userStepIncrement:1,evidenceClass:grant.evidenceClass});
        return json(response, 200, { explanation:'This pilot records comprehension and intent only. A canonical signed device command and independent policy gate are still required before any effect.', externalEffectsExecuted:0 });
      }
      if (request.method === 'POST' && url.pathname === '/api/v33.6/decision') {
        requireCsrf(request);
        const body = await readJson(request);
        if (!isRecord(body)) throw new HttpError(400, 'decision_body_invalid');
        const option = String(body.option ?? '');
        if (!['YES','NO','CHANGE_CONDITIONS','EXPLAIN'].includes(option)) throw new HttpError(400, 'decision_option_invalid');
        options.sessions.authorize({session,csrfToken:String(request.headers['x-csrf-token'] ?? ''),tenantId:grant.tenantId,userId:grant.userId,deviceId:grant.deviceId,cardId:grant.cardId,acceptedAt:now().toISOString()});
        const comprehensionSeconds = Number(body.comprehensionSeconds);
        if (!Number.isFinite(comprehensionSeconds) || comprehensionSeconds < 0 || comprehensionSeconds > 3600) throw new HttpError(400,'comprehension_invalid');
        options.telemetry.append({eventId:randomBytes(16).toString('hex'),sessionId:grant.sessionId,tenantId:grant.tenantId,eventType:'DECISION_SELECTED',occurredAt:now().toISOString(),userStepIncrement:1,evidenceClass:grant.evidenceClass});
        options.telemetry.append({eventId:randomBytes(16).toString('hex'),sessionId:grant.sessionId,tenantId:grant.tenantId,eventType:'DECISION_SUBMITTED',occurredAt:now().toISOString(),userStepIncrement:1,comprehensionSeconds,evidenceClass:grant.evidenceClass});
        options.telemetry.append({eventId:randomBytes(16).toString('hex'),sessionId:grant.sessionId,tenantId:grant.tenantId,eventType:'SESSION_COMPLETED',occurredAt:now().toISOString(),userStepIncrement:0,evidenceClass:grant.evidenceClass});
        return json(response, 202, { status:'pilot-intent-recorded', option, canonicalDecisionCreated:false, externalEffectsExecuted:0, requiredNextGate:'signed-device-command-and-policy-adjudication' });
      }
      throw new HttpError(404,'not_found');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : mapStatus(error);
      return json(response,status,{error:error instanceof Error?error.message:String(error)});
    }
  });
}

function serveAsset(root: string, pathname: string, response: ServerResponse): void {
  const name = pathname==='/'?'index.html':pathname.replace(/^\//,'');
  const allowed = new Set(['index.html','app.js','styles.css','manifest.webmanifest','sw.js','icon-192.png','icon-512.png']);
  if(!allowed.has(name)) throw new HttpError(404,'not_found');
  const file=resolve(root,name); const body=readFileSync(file); const ext=extname(name);
  const type=ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':ext==='.png'?'image/png':'application/manifest+json; charset=utf-8';
  response.statusCode=200;response.setHeader('content-type',type);response.setHeader('content-length',body.byteLength);response.end(body);
}
function parseSessionCookie(request: IncomingMessage): SignedEnvelope<PilotSessionGrantV33_6> {
  const cookies=Object.fromEntries((request.headers.cookie??'').split(';').map((part)=>part.trim()).filter(Boolean).map((part)=>{const i=part.indexOf('=');return i<0?[part,'']:[part.slice(0,i),part.slice(i+1)];}));
  const raw=cookies.pilot_session;if(raw===undefined)throw new HttpError(401,'pilot_session_required');
  try{return JSON.parse(Buffer.from(raw,'base64url').toString('utf8')) as SignedEnvelope<PilotSessionGrantV33_6>;}catch{throw new HttpError(401,'pilot_session_invalid');}
}
function requireCsrf(request: IncomingMessage): void { if(typeof request.headers['x-csrf-token']!=='string')throw new HttpError(403,'pilot_csrf_required'); }
async function readJson(request: IncomingMessage): Promise<unknown>{const chunks:Buffer[]=[];let size=0;for await(const chunk of request){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=buffer.length;if(size>64*1024)throw new HttpError(413,'request_too_large');chunks.push(buffer);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new HttpError(400,'json_invalid');}}
function json(response:ServerResponse,status:number,value:unknown):void{const body=Buffer.from(JSON.stringify(value));response.statusCode=status;response.setHeader('content-type','application/json; charset=utf-8');response.setHeader('content-length',body.length);response.end(body);}
function securityHeaders(response:ServerResponse):void{response.setHeader('cache-control','no-store');response.setHeader('x-content-type-options','nosniff');response.setHeader('x-frame-options','DENY');response.setHeader('referrer-policy','no-referrer');response.setHeader('permissions-policy','camera=(), microphone=(), geolocation=(), usb=()');response.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");}
function enforceOrigin(request:IncomingMessage,allowedOrigin:string|undefined):void{const origin=request.headers.origin;if(origin!==undefined&&(allowedOrigin===undefined||origin!==allowedOrigin))throw new HttpError(403,'origin_not_allowed');}
function cookie(name:string,value:string,maxAge:number):string{return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;}
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function mapStatus(error:unknown):number{const message=error instanceof Error?error.message:'';if(/not_registered|required|invalid|mismatch|revoked|inactive|expired|conflict|replay/.test(message))return 400;return 500;}
class HttpError extends Error{constructor(readonly status:number,message:string){super(message);}}
