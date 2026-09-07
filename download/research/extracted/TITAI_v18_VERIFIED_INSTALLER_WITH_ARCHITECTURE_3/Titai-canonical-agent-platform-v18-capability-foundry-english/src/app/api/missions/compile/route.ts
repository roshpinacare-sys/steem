import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";
import { compileMission } from "@/lib/missions/compiler";
import { persistCompiledMission } from "@/lib/capabilities/persistence";
const body=z.object({desiredOutcome:z.string().min(5).max(2000),inputs:z.array(z.string()).default([]),outputs:z.array(z.string()).min(1),constraints:z.array(z.string()).default(["No external network"]),successCriteria:z.array(z.string()).default([]),privacy:z.enum(["local_only","local_preferred","hybrid_optional"]).default("local_only"),networkPolicy:z.enum(["deny_all","loopback_only","allowlist"]).default("deny_all"),requiredEvidence:z.array(z.string()).default(["output hash"])});
export const runtime="nodejs";
export async function POST(req:Request){const session=await auth();if(!session?.user?.id)return NextResponse.json({error:"unauthorized"},{status:401});const parsed=body.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"invalid",issues:parsed.error.issues},{status:400});try{const scope=resolvePilotScope(session.user.id);const mission=compileMission({...parsed.data,tenantId:scope.tenantId,workspaceId:scope.workspaceId,ownerId:scope.userId,failureBehavior:"fail_closed"},[]);persistCompiledMission(mission,scope);return NextResponse.json({mission},{status:201});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"mission_compile_failed"},{status:400});}}
