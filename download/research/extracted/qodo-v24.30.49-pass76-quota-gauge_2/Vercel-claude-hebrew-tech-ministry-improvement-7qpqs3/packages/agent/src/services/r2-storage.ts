import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, writeFile, readFile } from "fs/promises";
import { realpathSync } from "fs";
import { dirname, resolve } from "path";
import { log } from "./logger.js";

export interface R2Config {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
}

export const FALLBACK_DIR = "/tmp/qodo-fallback";

export class R2Storage {
  private client: S3Client | null;
  private bucket: string;
  private degraded = false;
  constructor(env: R2Config = process.env as R2Config) {
    this.bucket = env.R2_BUCKET || "";
    const account = env.R2_ACCOUNT_ID;
    if (!account) { this.client = null; return; }
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${account}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  private fallbackPath(key: string): string {
    return `${FALLBACK_DIR}/${key.replace(/[^a-zA-Z0-9._/-]/g, "_")}`;
  }
  async putText(key: string, body: string) {
    if (this.client && !this.degraded) {
      try {
        await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body }));
        return;
      } catch (e: unknown) {
        log.warn(`R2 put failed, falling back to local disk`, { key, error: e instanceof Error ? e.message : String(e) });
        this.degraded = true;
      }
    }
    const path = this.fallbackPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, "utf-8");

    // Containment check: ensure the written path did not escape the fallback
    // directory via symlinks (adversarial key components, path traversal, etc.).
    const realPath = realpathSync(path);
    const root = realpathSync(FALLBACK_DIR);
    if (!realPath.startsWith(root.endsWith("/") ? root : `${root}/`)) {
      throw new Error(`R2Storage fallback path escaped containment: ${realPath}`);
    }
  }
  async getText(key: string): Promise<string> {
    if (this.client && !this.degraded) {
      try {
        const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        return (await r.Body?.transformToString()) || "";
      } catch (e: unknown) {
        log.warn(`R2 get failed, falling back to local disk`, { key, error: e instanceof Error ? e.message : String(e) });
        this.degraded = true;
      }
    }
    try {
      return await readFile(this.fallbackPath(key), "utf-8");
    } catch (e: unknown) {
      log.debug("r2-storage: fallback read miss", {
        key,
        error: e instanceof Error ? e.message : String(e),
      });
      return "";
    }
  }
  isDegraded(): boolean {
    return this.degraded;
  }
}
