/**
 * TFA Evolution Studio v28 — Engineering Assets Engine
 *
 * Template, snippet, script, recipe, and checklist management
 * with variable substitution and usage tracking.
 */

import fs from "fs";
import path from "path";
import { getAssetsDir, ensureDir } from "@/lib/paths";
import type { EngineeringAsset, AssetKind } from "@/lib/types";

const ASSETS_FILE = path.join(getAssetsDir(), "assets.json");

function loadAll(): EngineeringAsset[] {
  if (!fs.existsSync(ASSETS_FILE)) return getDefaultAssets();
  try {
    return JSON.parse(fs.readFileSync(ASSETS_FILE, "utf-8")) as EngineeringAsset[];
  } catch {
    return getDefaultAssets();
  }
}

function saveAll(assets: EngineeringAsset[]): void {
  ensureDir(path.dirname(ASSETS_FILE));
  fs.writeFileSync(ASSETS_FILE, JSON.stringify(assets, null, 2));
}

function getDefaultAssets(): EngineeringAsset[] {
  return [
    {
      id: "asset_1",
      kind: "template",
      name: "Next.js API Route",
      description: "Boilerplate for a Next.js API route with error handling.",
      tags: ["nextjs", "api", "template"],
      content: `import { NextRequest, NextResponse } from "next/server";
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return NextResponse.json({ success: true, data: body });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}`,
      variables: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
    },
    {
      id: "asset_2",
      kind: "checklist",
      name: "Release Checklist",
      description: "Pre-release verification steps.",
      tags: ["release", "process"],
      content: "- [ ] Smoke test passes\n- [ ] Version coherence verified\n- [ ] ZIP integrity checked\n- [ ] Release notes updated",
      variables: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
    },
  ];
}

export function loadAssets(): EngineeringAsset[] {
  return loadAll();
}

export function searchAssets(query: string, kind?: AssetKind): EngineeringAsset[] {
  const assets = loadAll();
  const q = query.toLowerCase();
  return assets.filter((a) => {
    const matchesKind = !kind || a.kind === kind;
    const matchesQuery =
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q));
    return matchesKind && matchesQuery;
  });
}

export function createAsset(
  asset: Omit<EngineeringAsset, "id" | "createdAt" | "updatedAt" | "usageCount">
): EngineeringAsset {
  const assets = loadAll();
  const newAsset: EngineeringAsset = {
    ...asset,
    id: `asset_${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
  };
  assets.push(newAsset);
  saveAll(assets);
  return newAsset;
}

export function recordAssetUsage(id: string): void {
  const assets = loadAll();
  const idx = assets.findIndex((a) => a.id === id);
  if (idx !== -1) {
    assets[idx].usageCount++;
    assets[idx].updatedAt = new Date().toISOString();
    saveAll(assets);
  }
}

export function applyAssetTemplate(
  asset: EngineeringAsset,
  variables: Record<string, string>
): string {
  let result = asset.content;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), value);
  }
  return result;
}
