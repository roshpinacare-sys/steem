/**
 * App — the desktop Mission Control entry.
 *
 * The old single-screen cockpit (floating glass panels over a full-screen
 * Three.js scene) has been replaced by PlatformShell: a real, navigable
 * product with a capability rail, command palette, mentor gate, and pages that
 * surface the agent's genuine telemetry. The 3D core now lives as a contained
 * accent on the Overview page instead of consuming the whole viewport.
 */
import React from "react";
import { PlatformShell } from "./shell/PlatformShell.js";

export function App(): React.ReactElement {
  return <PlatformShell />;
}
