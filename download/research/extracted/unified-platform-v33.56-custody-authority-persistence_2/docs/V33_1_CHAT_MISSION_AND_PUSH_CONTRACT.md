# V33.1 Chat Mission and Push Approval Contract

## Product objective

A user should be able to state an objective in chat. The platform converts that request into a bounded mission under an existing authority grant. Reversible, low-risk preparation may continue automatically. Material exceptions produce one concise approval card.

## Current implementation

`src/product/chat-mission.ts` provides:

- `compileChatMission` — validates tenant, subject, workspace, scopes, risk, cost, confidence, reversibility and expiry.
- `buildPushApprovalCard` — creates a bounded card only when policy requires approval.
- `recordApprovalDecision` — records Yes, No, Change conditions or Explain without executing effects.

## Safety invariants

- A chat request cannot create authority.
- Every requested scope must already exist in the bound canonical grant.
- Kernel high-risk scopes always require approval.
- Learned preference is not used to expand authority.
- Approval records preserve the exact requested scope set.
- Approval capture executes zero external effects.
- Current promotion ceiling remains `shadow`.

## Evidence achieved

- Low-risk reversible preparation proceeds without unnecessary approval.
- High-risk, high-cost, low-confidence, irreversible and unknown-reversibility requests are escalated.
- Cross-tenant and unauthorized-scope requests fail closed.
- Unauthorized reviewers and expired cards fail closed.

## Evidence not yet achieved

- Human comprehension in under ten seconds.
- Seventy percent reduction in user steps.
- Mobile/Web push delivery.
- Persistent mission chat and explanation generation.
- External effect execution after approval.
