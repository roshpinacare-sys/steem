import { and, eq } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { db, schema } from "@/lib/db";
import { sha256 } from "@/lib/durable/canonical-json";
import type { CapabilityCandidate } from "./foundry";
import type { CompiledMission } from "@/lib/missions/compiler";

export function persistCapabilityCandidate(candidate: CapabilityCandidate, scope:{tenantId:string;workspaceId:string;userId:string}) {
  if(candidate.tenantId!==scope.tenantId||candidate.workspaceId!==scope.workspaceId||candidate.requestedBy!==scope.userId) throw new Error("candidate_scope_mismatch");
  const candidateHash=sha256(candidate);
  const existing=db.select().from(schema.capabilityCandidates).where(and(eq(schema.capabilityCandidates.candidateHash,candidateHash),eq(schema.capabilityCandidates.tenantId,scope.tenantId),eq(schema.capabilityCandidates.workspaceId,scope.workspaceId))).get();
  if(existing)return existing;
  db.insert(schema.capabilityCandidates).values({id:candidate.id,tenantId:scope.tenantId,workspaceId:scope.workspaceId,ownerId:scope.userId,name:candidate.unsignedManifest.name,description:candidate.unsignedManifest.description,packageType:candidate.unsignedManifest.packageType,state:candidate.state==="signed"?"signed":candidate.state==="qualified"?"qualified":candidate.state==="rejected"?"rejected":"quarantined",reuseDecision:candidate.reuse.decision,specificationHash:candidate.specificationHash,candidateHash,candidate:candidate as unknown as Record<string,unknown>,createdAt:new Date(),updatedAt:new Date()}).run();
  return db.select().from(schema.capabilityCandidates).where(eq(schema.capabilityCandidates.id,candidate.id)).get();
}
export function persistCompiledMission(mission:CompiledMission,scope:{tenantId:string;workspaceId:string;userId:string}){
 if(mission.tenantId!==scope.tenantId||mission.workspaceId!==scope.workspaceId||mission.ownerId!==scope.userId)throw new Error("mission_scope_mismatch");
 const existing=db.select().from(schema.compiledMissions).where(and(eq(schema.compiledMissions.missionHash,mission.missionHash),eq(schema.compiledMissions.tenantId,scope.tenantId),eq(schema.compiledMissions.workspaceId,scope.workspaceId))).get();if(existing)return existing;
 db.insert(schema.compiledMissions).values({id:mission.id,revision:mission.revision,tenantId:scope.tenantId,workspaceId:scope.workspaceId,ownerId:scope.userId,intent:mission.intent as unknown as Record<string,unknown>,plan:{steps:mission.steps} as Record<string,unknown>,semanticDiff:mission.semanticDiff as Array<Record<string,unknown>>,findings:mission.findings as Array<Record<string,unknown>>,gaps:mission.gaps as Array<Record<string,unknown>>,missionHash:mission.missionHash,status:mission.status,createdAt:new Date()}).run();return db.select().from(schema.compiledMissions).where(eq(schema.compiledMissions.id,mission.id)).get();
}
export function persistSignedPackage(o:{manifest:Record<string,unknown>;manifestHash:string;packageHash:string;tenantId:string;workspaceId:string;ownerId:string;state?:"quarantined"|"qualified"|"installed"|"active"}){const m=o.manifest as {packageId:string;version:string;packageType:string;name:string;description:string;publisher:{id:string;keyId:string}};const id=createId();db.insert(schema.capabilityPackages).values({id,packageId:m.packageId,version:m.version,packageType:m.packageType as never,name:m.name,description:m.description,publisherId:m.publisher.id,publisherKeyId:m.publisher.keyId,manifest:o.manifest,manifestHash:o.manifestHash,packageHash:o.packageHash,state:o.state??"quarantined",inspection:{},tenantId:o.tenantId,workspaceId:o.workspaceId,ownerId:o.ownerId,importedAt:new Date(),updatedAt:new Date()}).onConflictDoNothing().run();return id;}
export function capabilitySnapshot(scope:{tenantId:string;workspaceId:string}){return {packages:db.select().from(schema.capabilityPackages).where(and(eq(schema.capabilityPackages.tenantId,scope.tenantId),eq(schema.capabilityPackages.workspaceId,scope.workspaceId))).all(),candidates:db.select().from(schema.capabilityCandidates).where(and(eq(schema.capabilityCandidates.tenantId,scope.tenantId),eq(schema.capabilityCandidates.workspaceId,scope.workspaceId))).all(),missions:db.select().from(schema.compiledMissions).where(and(eq(schema.compiledMissions.tenantId,scope.tenantId),eq(schema.compiledMissions.workspaceId,scope.workspaceId))).all()};}
