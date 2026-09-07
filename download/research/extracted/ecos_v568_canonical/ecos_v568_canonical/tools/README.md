# ECOS Team Tools (for the AI bots, the lead integrator, and the owner)

These are working React dashboards used to *understand and steer* the project —
not part of the runtime server. They are the "navigator" layer the owner asked for.

## EcosNavigator214.jsx — System Navigator
A single-screen map of the whole platform: domains, versions, status, and what to
do next. Use it to orient before a session ("what exists, what's healthy, what's
the next high-leverage move") instead of re-reading 22k lines of server code.

## EcosResearchConsole214.jsx — Research Console
Embeds the current ECOS research prompt and renders structured research output
(one-liner, wedge, first customer, case studies, red flags, V214+ moves) from the
strict JSON schema. Use it to run/҂review research rounds consistently.

## How to run
Both are standalone components with a default export. Drop either into the Vite
starter shipped in `templates/vite-react-shadcn/` (set it as the root component in
`src/main.jsx`), then `npm i && npm run dev`. They can also be pasted into any
React canvas / artifact host for a quick view. No backend required — they are
read-only UIs (the Research console calls the LLM/agent endpoints from the V225
orchestration surface when available).

## For the bots / lead integrator
Treat these as the shared "control room." When planning a version, update the
Navigator's domain/status data to reflect reality, and use the Research console to
keep research grounded in the same prompt + schema every round.
