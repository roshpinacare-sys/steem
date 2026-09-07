/**
 * Type surface for the plain-JS Cloudflare Worker webhook receiver, so the
 * TypeScript test suite (tests/integrations/pass-24-webhook-boundaries.test.ts)
 * can import it without an implicit `any`.
 */
export interface WebhookSender {
  login?: string;
  type?: string;
}

export interface WebhookApp {
  slug?: string;
}

export function isQodoSender(sender: WebhookSender | null | undefined, qodoLogin: string): boolean;
export function isQodoApp(app: WebhookApp | null | undefined, qodoAppSlug: string): boolean;

declare const worker: {
  fetch(request: Request, env: Record<string, unknown>): Promise<Response>;
};
export default worker;
