# The Standing Supervisor-Inspector (מפקח מבקר)

The operator's standing order: **all work is examined thoroughly before every push**
("תביא מפקח מבקר שיבדקו אותך היטב... תמשיך ודחוף", 2026-09-19).

Until R65 this order was honored once, ad-hoc (the `fleet-inspect` audit of
2026-09-19, which found 10 engineering findings + one false-at-write-time
claim). The R64 delivery was pushed without an independent inspection - the
exact gap the operator named. This directory is the institution that closes
it permanently.

## The protocol

**When.** Every agent delivery to this repository that does any of:

1. adds or changes an entry in the requests book (`agent/requests.json`),
2. changes machine code (the truth gate, the verifier, any watcher or workflow),
3. changes public content pages.

Machine commits (hourly verdicts of the machines themselves) are
measurements, not deliveries - the truth gate already measures them.

**Who.** An independent agent instance with fresh context and no stake in the
delivery. The delivering agent's own smoke tests are necessary but never
sufficient: the inspector re-measures, never accepts.

**What.** The inspection checks, with evidence for each:

1. **Claims vs live truth** - every material claim in the delivery's evidence
   re-measured against the live public state (the sites, the books, the chain).
2. **Red-before / green-after** - the delivery's detectors proven to bite:
   the failing state shown before the fix, the passing state after.
3. **Security** - the diff scanned for secret values, secret-name maps of
   private infrastructure, and needless attack-surface publication.
4. **Professionalism** - no conversation artifacts, no internal chatter, no
   glyphs banned by the site's own language contract.
5. **Scope and truth of the diff itself** - line-by-line: nothing beyond the
   stated delivery, nothing silently reverted, commit messages true to content.

**Where.** The report is committed with the delivery as
`agent/inspections/INS-<delivery>-<seq>.json`, publicly served. Post-hoc audits
(a delivery that escaped inspection) are labeled as such - honest, never
disguised as pre-push.

## Machine enforcement

Assertion **A69 (`inspection_integrity`)** in `agent/verify/` checks the live
public book on every verification run, forever:

- every delivered request **R27 onward** must carry an `inspection` field
  referencing a report file that is actually served at the public URL;
- the bridgehead's `requestRef`, once R27+, must carry one too.

R22-R26 are pre-institution entries - grandfathered, documented, and covered by
the R64 repair (TRUTH-AUDIT section 9). From R27 there is no grandfathering:
**an un-inspected delivery cannot pass verification.**

## The first report

`INS-R65-001.json` - the institution's founding audit: the R64 delivery
audited post-hoc (it escaped inspection), the R65 delivery inspected before
its push, and a sweep of the live state (both public homes, the machines, the
chain books).
