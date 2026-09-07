// ============================================================================
// TFA Evolution Studio v17 — GET /api/compiler/adapters
//
// Returns registered target adapters, recipe store, and V17 distillation report.
// ============================================================================

import { NextResponse } from "next/server";
import { listAdapters } from "@/lib/compiler/adapter-registry";
import { listRecipes, getDistillationReport } from "@/lib/compiler/recipe-store";

export async function GET(): Promise<NextResponse> {
  const adapters = listAdapters();
  const recipeStore = listRecipes();
  const distillation = getDistillationReport();

  return NextResponse.json({
    adapters,
    adapterCount: adapters.length,
    recipes: recipeStore.recipes,
    recipeCount: recipeStore.recipes.length,
    totalJobsLearned: recipeStore.totalJobsLearned,
    updatedAt: recipeStore.updatedAt,
    distillation,
  });
}
