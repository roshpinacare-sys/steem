/**
 * useWebContainer — the Studio's engine. Boots a single WebContainer (a real
 * Node.js runtime in the browser), mounts a starter project, and exposes the
 * operations the UI drives: read/write files, run a command with streamed
 * output, start a dev server (and capture its preview URL), and build.
 *
 * Only ONE WebContainer may exist per page, so the instance is a module
 * singleton shared across mounts. Booting requires cross-origin isolation
 * (COOP/COEP) — when that's missing the hook reports a clear, actionable state
 * instead of throwing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { WebContainer } from "@webcontainer/api";
import type { FileSystemTree } from "@webcontainer/api";

export type BootState = "idle" | "booting" | "ready" | "unsupported" | "error";
export type ProcState = "idle" | "running";

export interface TerminalLine {
  id: number;
  text: string;
  kind: "out" | "cmd" | "sys";
}

let singleton: WebContainer | null = null;
let booting: Promise<WebContainer> | null = null;

async function bootOnce(): Promise<WebContainer> {
  if (singleton) return singleton;
  if (!booting) {
    booting = WebContainer.boot().then((wc) => {
      singleton = wc;
      return wc;
    });
  }
  return booting;
}

export interface FileNode {
  path: string;      // full path, e.g. "src/main.js"
  name: string;      // basename
  dir: boolean;
}

export interface UseWebContainer {
  bootState: BootState;
  error: string | null;
  files: FileNode[];
  procState: ProcState;
  lines: TerminalLine[];
  previewUrl: string | null;
  serverPort: number | null;
  boot: (tree: FileSystemTree, entry?: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, contents: string) => Promise<void>;
  run: (command: string, args: string[]) => Promise<number | null>;
  stop: () => void;
  clearTerminal: () => void;
  refreshTree: () => Promise<void>;
}

export function useWebContainer(): UseWebContainer {
  const [bootState, setBootState] = useState<BootState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [procState, setProcState] = useState<ProcState>("idle");
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [serverPort, setServerPort] = useState<number | null>(null);

  const wcRef = useRef<WebContainer | null>(null);
  const procRef = useRef<{ kill: () => void } | null>(null);
  const lineId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const emit = useCallback((text: string, kind: TerminalLine["kind"]) => {
    if (!mounted.current) return;
    setLines((prev) => {
      const next = [...prev, { id: lineId.current++, text, kind }];
      return next.length > 2000 ? next.slice(-2000) : next;
    });
  }, []);

  const listTree = useCallback(async (wc: WebContainer): Promise<FileNode[]> => {
    const out: FileNode[] = [];
    async function walk(dir: string, depth: number) {
      if (depth > 4) return;
      let entries: { name: string; isDirectory(): boolean }[];
      try {
        entries = (await wc.fs.readdir(dir, { withFileTypes: true })) as unknown as {
          name: string; isDirectory(): boolean;
        }[];
      } catch {
        return;
      }
      for (const e of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        const full = dir === "/" ? e.name : `${dir}/${e.name}`;
        const isDir = e.isDirectory();
        out.push({ path: full, name: e.name, dir: isDir });
        if (isDir) await walk(full, depth + 1);
      }
    }
    await walk("/", 0);
    return out;
  }, []);

  const refreshTree = useCallback(async () => {
    const wc = wcRef.current;
    if (!wc) return;
    setFiles(await listTree(wc));
  }, [listTree]);

  const boot = useCallback(async (tree: FileSystemTree) => {
    if (typeof window !== "undefined" && !window.crossOriginIsolated) {
      setBootState("unsupported");
      return;
    }
    setBootState("booting");
    setError(null);
    emit("Booting WebContainer runtime…", "sys");
    try {
      // Guard against an indefinite boot when the runtime CDN is unreachable
      // (offline / restrictive network) — fail with a clear message instead.
      const wc = await Promise.race([
        bootOnce(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("runtime did not boot within 30s — the WebContainer runtime may be unreachable on this network")), 30_000),
        ),
      ]);
      wcRef.current = wc;
      wc.on("server-ready", (port, url) => {
        if (!mounted.current) return;
        setServerPort(port);
        setPreviewUrl(url);
        emit(`Server ready on port ${port} → ${url}`, "sys");
      });
      wc.on("error", (err) => emit(`runtime error: ${err.message}`, "sys"));
      await wc.mount(tree);
      setBootState("ready");
      emit("Runtime ready. Mounted starter project.", "sys");
      await refreshTree();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setBootState("error");
      emit(`boot failed: ${msg}`, "sys");
    }
  }, [emit, refreshTree]);

  const readFile = useCallback(async (path: string): Promise<string> => {
    const wc = wcRef.current;
    if (!wc) return "";
    try { return await wc.fs.readFile(path, "utf-8"); } catch { return ""; }
  }, []);

  const writeFile = useCallback(async (path: string, contents: string) => {
    const wc = wcRef.current;
    if (!wc) return;
    const slash = path.lastIndexOf("/");
    if (slash > 0) {
      try { await wc.fs.mkdir(path.slice(0, slash), { recursive: true }); } catch { /* exists */ }
    }
    await wc.fs.writeFile(path, contents);
    await refreshTree();
  }, [refreshTree]);

  const run = useCallback(async (command: string, args: string[]): Promise<number | null> => {
    const wc = wcRef.current;
    if (!wc || procState === "running") return null;
    setProcState("running");
    emit(`$ ${command} ${args.join(" ")}`.trim(), "cmd");
    try {
      const proc = await wc.spawn(command, args);
      procRef.current = proc;
      proc.output.pipeTo(new WritableStream({
        write(data) { emit(String(data).replace(/\[[0-9;]*m/g, ""), "out"); },
      })).catch(() => {});
      const code = await proc.exit;
      if (mounted.current) { setProcState("idle"); emit(`exit ${code}`, "sys"); }
      procRef.current = null;
      await refreshTree();
      return code;
    } catch (e: unknown) {
      if (mounted.current) { setProcState("idle"); emit(`error: ${e instanceof Error ? e.message : String(e)}`, "sys"); }
      procRef.current = null;
      return null;
    }
  }, [emit, procState, refreshTree]);

  const stop = useCallback(() => {
    procRef.current?.kill();
    procRef.current = null;
    setProcState("idle");
    emit("process stopped", "sys");
  }, [emit]);

  const clearTerminal = useCallback(() => setLines([]), []);

  return {
    bootState, error, files, procState, lines, previewUrl, serverPort,
    boot, readFile, writeFile, run, stop, clearTerminal, refreshTree,
  };
}
