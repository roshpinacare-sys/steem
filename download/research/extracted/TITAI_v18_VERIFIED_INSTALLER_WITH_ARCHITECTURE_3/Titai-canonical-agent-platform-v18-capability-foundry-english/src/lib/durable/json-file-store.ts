import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MemoryDurableStore } from "./memory-store";
import type { DurableSnapshot } from "./types";

export class JsonFileDurableStore extends MemoryDurableStore {
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const snapshot = JSON.parse(raw) as DurableSnapshot;
      await super.restore(snapshot);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  protected override async afterMutation(): Promise<void> {
    if (!this.loaded) return;
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const snapshot = await super.snapshot();
      const tempPath = `${this.filePath}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(tempPath, this.filePath);
    });
    await this.writeChain;
  }
}
