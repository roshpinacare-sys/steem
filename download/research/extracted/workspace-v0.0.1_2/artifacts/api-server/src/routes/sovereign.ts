import { Router } from "express";
import { buildSovereignStack } from "../../sovereign/src/composition.ts";
import { mountSovereignRoutes } from "../../sovereign/src/http/express-adapter.ts";

const sovereignRouter = Router();
const stack = buildSovereignStack();
mountSovereignRoutes(sovereignRouter, stack);

// Start the scheduled solvency auditor — sweeps every 30 s.
// unref()'d inside LedgerCron so the timer never prevents clean shutdown.
stack.monitor.start(30_000);

export default sovereignRouter;
export { stack };
