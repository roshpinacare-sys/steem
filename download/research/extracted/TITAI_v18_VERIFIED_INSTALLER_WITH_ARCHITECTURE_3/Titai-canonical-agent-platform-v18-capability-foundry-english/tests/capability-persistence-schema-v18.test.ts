import { describe,expect,it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { capabilityCandidates,capabilityInstallations,capabilityPackages } from "@/lib/db/schema";
describe("v18 persistence schema",()=>{it("matches canonical lifecycle column names",()=>{expect(getTableColumns(capabilityPackages).importedAt.name).toBe("imported_at");expect(getTableColumns(capabilityInstallations).installedAt.name).toBe("installed_at");expect(getTableColumns(capabilityCandidates).createdAt.name).toBe("created_at");});});
