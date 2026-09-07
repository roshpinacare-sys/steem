import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";
import { capabilitySnapshot } from "@/lib/capabilities/persistence";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){const session=await auth();if(!session?.user?.id)return NextResponse.json({error:"unauthorized"},{status:401});try{const scope=resolvePilotScope(session.user.id);return NextResponse.json({scope,snapshot:capabilitySnapshot(scope)});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"capability_snapshot_failed"},{status:400});}}
