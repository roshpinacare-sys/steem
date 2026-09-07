import { describe,expect,it } from "vitest";
import { inspectManifest, normalizePackagePath, verifyManifestSignature } from "@/lib/capabilities/package-standard";
import { packageFixture, tamperManifest } from "./v18-fixtures";
describe("v18 signed capability packages",()=>{
 it("accepts a signed scoped package",()=>{const f=packageFixture();expect(inspectManifest({manifest:f.manifest,files:f.files,trust:f.trust,tenantId:"tenant-a",workspaceId:"workspace-a",titaiVersion:"2.2.0"}).accepted).toBe(true);});
 it("rejects a modified manifest",()=>{const f=packageFixture();expect(verifyManifestSignature(tamperManifest(f.manifest,{description:"changed"}),f.keys.publicKeyPem)).toBe(false);});
 it("rejects modified file content",()=>{const f=packageFixture();const r=inspectManifest({manifest:f.manifest,files:{...f.files,"src/capability.mjs":"changed"},trust:f.trust,tenantId:"tenant-a",workspaceId:"workspace-a",titaiVersion:"2.2.0"});expect(r.findings.some(x=>x.code==="file_hash_mismatch")).toBe(true);});
 it("rejects revoked publisher",()=>{const f=packageFixture();const r=inspectManifest({manifest:f.manifest,files:f.files,trust:{...f.trust,revokedAt:new Date().toISOString()},tenantId:"tenant-a",workspaceId:"workspace-a",titaiVersion:"2.2.0"});expect(r.accepted).toBe(false);});
 it("rejects cross tenant publisher scope",()=>{const f=packageFixture();expect(inspectManifest({manifest:f.manifest,files:f.files,trust:f.trust,tenantId:"tenant-b",workspaceId:"workspace-a",titaiVersion:"2.2.0"}).accepted).toBe(false);});
 it.each(["../secret","/etc/passwd","C:\\secret","a/../../b"])("rejects unsafe path %s",path=>expect(()=>normalizePackagePath(path)).toThrow());
});
