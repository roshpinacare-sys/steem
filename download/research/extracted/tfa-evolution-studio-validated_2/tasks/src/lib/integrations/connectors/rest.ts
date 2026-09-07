/**
 * TFA Evolution Studio v28 — REST Connector
 */

export async function restAction(action: string, params: Record<string, unknown>): Promise<unknown> {
  return { action, params, provider: "rest" };
}
