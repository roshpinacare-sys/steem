/**
 * [agent-zai/W1] Next.js instrumentation hook — boots the sovereign
 * beat scheduler inside the platform-managed server process (the only
 * persistent process on this host). See src/lib/beat-scheduler.ts.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBeatScheduler } = await import("./lib/beat-scheduler");
  startBeatScheduler();
}
