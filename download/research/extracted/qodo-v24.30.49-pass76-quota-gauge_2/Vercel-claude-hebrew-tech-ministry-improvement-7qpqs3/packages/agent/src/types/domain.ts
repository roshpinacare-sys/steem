/**
 * Domain type aliases shared across layers.
 *
 * The canonical shapes are the Zod-inferred schema types (src/schemas/ is a
 * leaf layer). Agents re-export these same aliases for their callers;
 * services must import from here — importing from ../agents/* inverts the
 * layering (services → agents) and is forbidden.
 */
export type { ArchitectOutput as Plan } from "../schemas/architect-schema.js";
export type { CoderOutput as Patch } from "../schemas/coder-schema.js";
