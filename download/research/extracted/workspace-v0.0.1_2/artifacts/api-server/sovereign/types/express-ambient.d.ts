/**
 * types/express-ambient.d.ts — minimal ambient declaration for "express" (types only).
 * Lets the zero-dependency sovereign kernel typecheck offline (tsc strict) without installing
 * express. At runtime nothing changes: express-adapter only does `import type` from "express",
 * and the REAL express types (from the host app's node_modules) take precedence when present —
 * TypeScript prefers concrete package types over ambient module declarations.
 */
declare module "express" {
  export interface Request {
    header(name: string): string | undefined;
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
    params: Record<string, string>;
  }
  export interface Response {
    status(code: number): Response;
    json(body: unknown): Response;
    type(contentType: string): Response;
    setHeader(name: string, value: string | number): Response;
    send(body: unknown): Response;
  }
  export type NextFunction = (err?: unknown) => void;
  export interface Router {
    get(path: string, handler: (req: Request, res: Response, next: NextFunction) => unknown): unknown;
    post(path: string, handler: (req: Request, res: Response, next: NextFunction) => unknown): unknown;
    put(path: string, handler: (req: Request, res: Response, next: NextFunction) => unknown): unknown;
    patch(path: string, handler: (req: Request, res: Response, next: NextFunction) => unknown): unknown;
    delete(path: string, handler: (req: Request, res: Response, next: NextFunction) => unknown): unknown;
  }
}
