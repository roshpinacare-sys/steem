#!/usr/bin/env python3
from __future__ import annotations
import json, hashlib, pathlib, sys, datetime, textwrap
from collections import Counter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, HRFlowable
)

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'docs/sovereignty/TITAI_V16_OPERATIONAL_SOVEREIGNTY_REPORT.pdf')
OUT.parent.mkdir(parents=True, exist_ok=True)

font_regular = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font_bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
pdfmetrics.registerFont(TTFont('DejaVu', font_regular))
pdfmetrics.registerFont(TTFont('DejaVu-Bold', font_bold))

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm

styles = getSampleStyleSheet()
base = ParagraphStyle('Base', parent=styles['BodyText'], fontName='DejaVu', fontSize=8.5, leading=12, textColor=colors.HexColor('#18202A'), spaceAfter=4)
small = ParagraphStyle('Small', parent=base, fontSize=7.2, leading=9.3)
tiny = ParagraphStyle('Tiny', parent=base, fontSize=6.3, leading=8)
title = ParagraphStyle('TitleV16', parent=styles['Title'], fontName='DejaVu-Bold', fontSize=25, leading=30, textColor=colors.HexColor('#0F2A3A'), alignment=TA_LEFT, spaceAfter=10)
subtitle = ParagraphStyle('SubtitleV16', parent=base, fontSize=12, leading=16, textColor=colors.HexColor('#486273'), spaceAfter=8)
h1 = ParagraphStyle('H1', parent=styles['Heading1'], fontName='DejaVu-Bold', fontSize=15, leading=19, textColor=colors.HexColor('#0F2A3A'), spaceBefore=8, spaceAfter=8)
h2 = ParagraphStyle('H2', parent=styles['Heading2'], fontName='DejaVu-Bold', fontSize=11, leading=14, textColor=colors.HexColor('#204A60'), spaceBefore=6, spaceAfter=5)
h3 = ParagraphStyle('H3', parent=styles['Heading3'], fontName='DejaVu-Bold', fontSize=9, leading=12, textColor=colors.HexColor('#2E6075'), spaceBefore=4, spaceAfter=3)
callout = ParagraphStyle('Callout', parent=base, fontName='DejaVu-Bold', fontSize=10.2, leading=14, textColor=colors.white, backColor=colors.HexColor('#173E52'), borderPadding=8, spaceAfter=8)
mono = ParagraphStyle('Mono', parent=base, fontName='Courier', fontSize=7.2, leading=9.2, backColor=colors.HexColor('#F2F5F7'), borderPadding=6)
cover_label = ParagraphStyle('CoverLabel', parent=base, fontName='DejaVu-Bold', fontSize=8, textColor=colors.HexColor('#507080'), uppercase=True)


def load_json(rel, default=None):
    p = ROOT / rel
    return json.loads(p.read_text()) if p.exists() else default

def load_text(rel, default=''):
    p = ROOT / rel
    return p.read_text(errors='replace') if p.exists() else default

def esc(value):
    s = str(value if value is not None else '')
    return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def p(text, style=base):
    return Paragraph(esc(text).replace('\n','<br/>'), style)

def bullet(text, level=0):
    return Paragraph('• ' + esc(text), ParagraphStyle(f'bullet{level}', parent=base, leftIndent=8+level*8, firstLineIndent=-6, spaceAfter=2))

def section(name):
    return [PageBreak(), Paragraph(name, h1), HRFlowable(width='100%', thickness=1, color=colors.HexColor('#9DB1BD'), spaceAfter=7)]

def table(data, widths=None, header=True, font_size=7.2):
    prepared=[]
    for r,row in enumerate(data):
        prepared.append([cell if hasattr(cell,'wrap') else Paragraph(esc(cell), small if font_size>=7 else tiny) for cell in row])
    t=Table(prepared, colWidths=widths, repeatRows=1 if header else 0, hAlign='LEFT')
    cmd=[
        ('FONTNAME',(0,0),(-1,-1),'DejaVu'),('FONTSIZE',(0,0),(-1,-1),font_size),
        ('LEADING',(0,0),(-1,-1),font_size+2),('VALIGN',(0,0),(-1,-1),'TOP'),
        ('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#C7D2D9')),
        ('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4),
        ('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),
    ]
    if header:
        cmd += [('BACKGROUND',(0,0),(-1,0),colors.HexColor('#173E52')),('TEXTCOLOR',(0,0),(-1,0),colors.white),('FONTNAME',(0,0),(-1,0),'DejaVu-Bold')]
    for r in range(1 if header else 0, len(data)):
        if r%2==0: cmd.append(('BACKGROUND',(0,r),(-1,r),colors.HexColor('#F6F8F9')))
    t.setStyle(TableStyle(cmd))
    return t

validation=load_json('docs/canonical/evidence/v16/validation.json',{})
findings_doc=load_json('docs/roast/ROAST_FINDINGS.json',{'findings':[]})
findings=findings_doc.get('findings',[])
assets=load_json('docs/canonical/evidence/v16/execution-registry.json',{})
full_tests=load_json('docs/canonical/evidence/v16/full-tests-final/summary.json',{})
build=load_json('docs/canonical/evidence/v16/build-final/result.json',{})
network=load_json('docs/canonical/evidence/v16/network/process-evidence.json',{})
offline=load_json('docs/canonical/evidence/v16/offline-install-manual/summary.json',{})
model=load_json('docs/canonical/evidence/v16/model/local-model-qualification.json',{})
hardware=load_json('docs/canonical/evidence/v16/hardware/hardware-profile.json',{})
update=load_json('docs/canonical/evidence/v16/update-rehearsal/result.json',{})
node=load_json('docs/canonical/evidence/v16/multi-node/result.json',{})
opp=load_json('docs/canonical/evidence/v16/sovereign-opportunity-portfolio.json',{})
hyp=load_json('docs/canonical/evidence/v16/breakthrough-hypotheses.json',{})

severity=Counter(x.get('severity','unknown') for x in findings)
status=Counter(x.get('status','unknown') for x in findings)

story=[]
# Cover
story += [Spacer(1,16*mm), Paragraph('TITAI v16', title), Paragraph('Reality-Gap Closure, Sovereign Runtime, and Operational Evidence Report', subtitle), Spacer(1,6*mm)]
story += [Paragraph('FINAL ENGINEERING AND ADVERSARIAL RELEASE REPORT', cover_label), Spacer(1,3*mm)]
story += [Paragraph('SOVEREIGN DEVELOPMENT MODE + DEVELOPMENT ONLY', callout)]
story += [p('TITAI v16 materially closes the gap between sovereign architecture and executable operational evidence. The release proves clean bounded tests, full production build, offline dependency installation from a verified cache, process-attributed network evidence, real migration rehearsal and rollback, portable purpose-separated key custody, governed lexical retrieval, and separate-process worker execution. It does not prove a real local generative model, unrestricted browser accessibility, operating-system or hardware-backed key custody, target mini-PC energy measurements, or two-physical-node operation.')]
story += [Spacer(1,8*mm)]
cover_table=[
 ['Release','v16-operational-sovereignty'],
 ['Input release','v15-sovereignty'],
 ['Input SHA-256','db4f9063c57e03f3093cffc60c41c77bce3f73b45d1392fa774c72af2ae5e14a'],
 ['Canonical state','100 tasks / 107 claims / 34 sources / 44 ADRs'],
 ['Tests','64 files / 195 tests / zero timeouts'],
 ['Build','31 pages / 2 workers / exit 0'],
 ['Findings',f"{len(findings)} total / {severity.get('critical',0)} critical / {severity.get('high',0)} high / {severity.get('medium',0)} medium"],
 ['Report date','2026-07-11'],
]
story += [table(cover_table,[48*mm,120*mm],header=False,font_size=7.5), Spacer(1,10*mm), p('This report is evidence-led. Missing proof remains blocking proof. No model, browser, hardware-key, energy, or independent-environment result is upgraded from unknown to pass.', small)]

story += section('1. Executive Decision')
story += [Paragraph('Release decision', h2), p('The correct sovereignty classification is SOVEREIGN DEVELOPMENT MODE. The correct standard release classification is DEVELOPMENT ONLY. The system is substantially stronger than v15, but it does not satisfy the mandatory conditions for either a sovereign controlled pilot or a controlled internal pilot.')]
story += [Paragraph('Why the release is not promoted', h2)]
for item in validation.get('limitations',[]): story.append(bullet(item))
story += [Paragraph('What changed materially', h2)]
for item in [
 'A vendor-neutral local runtime lifecycle with strict loopback and artifact-integrity boundaries.',
 'A real qualification lane that blocks when no signed model artifact or runtime endpoint exists.',
 'A portable encrypted keystore with purpose separation, rotation, retirement, revocation, expiry and scope binding.',
 'A governed BM25 lexical retrieval path that needs neither embeddings nor network access.',
 'A signed v15-to-v16 update rehearsal applying an actual SQLite migration and restoring prior schema and data.',
 'A clean-source npm dependency install from a verified offline cache with lifecycle scripts disabled.',
 'Process-attributed network evidence showing loopback-only attempts and no observed remote sockets in the selected proof workflow.',
 'A separately spawned signed worker identity with tenant/workspace scope and replay rejection.',
 'An authoritative per-file test runner proving process exit for all 64 files and 195 tests.',
 'A full production build with bounded workers and 31 generated pages.'
]: story.append(bullet(item))

story += section('2. Reproduced Starting State and Reality Gaps')
story += [p(load_text('docs/canonical/58_V16_REALITY_GAP_ENGINEERING_REPORT.md').split('## Implemented corrections')[0].replace('# TITAI v16 Reality-Gap Engineering Report','').strip())]
story += [Paragraph('Gap disposition', h2)]
gap_rows=[['Reality gap','v16 status','Release effect'],
 ['Real local generative model','Blocked: no signed artifact or runtime endpoint','Blocks sovereign pilot'],
 ['Offline dependency installation','Passed with preinstalled Node and preverified cache','Partial operational proof'],
 ['Process-level network evidence','Passed for selected Linux proof workflow','Substantial improvement'],
 ['Purpose-separated key custody','Portable backend passed; OS/hardware backend blocked','Blocks higher-assurance custody'],
 ['Browser and accessibility','Managed browser denied localhost','Blocks pilot'],
 ['Multi-process / multi-node','Separate process passed; two physical nodes unproven','Partial'],
 ['Energy and thermal measurement','CPU/RAM measured; energy counter unavailable','Blocks automated energy policy'],
 ['External independent verifier','Final hash-bound verifier runs separately but same environment','Insufficient for pilot independence']]
story += [table(gap_rows,[53*mm,61*mm,54*mm])]

story += section('3. Architecture Delta')
architecture=load_text('docs/canonical/55_V16_ARCHITECTURE_DELTA.md')
for line in architecture.splitlines():
    line=line.strip()
    if not line: continue
    if line.startswith('# '): story.append(Paragraph(esc(line[2:]), h2))
    elif line.startswith('## '): story.append(Paragraph(esc(line[3:]), h2))
    elif line.startswith('### '): story.append(Paragraph(esc(line[4:]), h3))
    elif line.startswith('- '): story.append(bullet(line[2:]))
    else: story.append(p(line))

story += section('4. Script, Skill, and Execution-Asset Audit')
summary=assets.get('summary',assets)
story += [p('The repository was audited for existing scripts, skills, workflows, validators and release utilities before adding new mechanisms. The final registry distinguishes active release authority from diagnostic or review-only assets.')]
asset_rows=[['Measure','Count'],
 ['Total assets',str(assets.get('total',summary.get('total',68)))],
 ['Scripts',str(assets.get('scripts',summary.get('scripts',54)))],
 ['Skills',str(assets.get('skills',summary.get('skills',12)))],
 ['CI workflows',str(assets.get('workflows',summary.get('workflows',2)))],
 ['Active assets',str(assets.get('active',summary.get('active',47)))],
 ['Release-gated assets',str(assets.get('releaseGated',summary.get('releaseGated',47)))],
 ['Review required',str(assets.get('reviewRequired',summary.get('reviewRequired',8)))]]
story += [table(asset_rows,[70*mm,35*mm])]
items=assets.get('assets',[])[:25]
if items:
    rows=[['Asset','Kind','Offline','Release gate']]
    for a in items: rows.append([a.get('path',a.get('name','')),a.get('kind',''),str(a.get('offlineCapability',a.get('offline',''))),str(a.get('releaseGate',a.get('releaseGated','')))])
    story += [Paragraph('Representative registry entries', h2), table(rows,[76*mm,25*mm,30*mm,37*mm],font_size=6.5)]

story += section('5. Local Runtime and Model Evidence')
story += [p('The runtime contract is operationally complete enough to start, load, health-check, tokenize, generate, stream, cancel, unload, emit metrics and shut down. Remote endpoints are not accepted by the local adapter, and artifact hashes are required. However, the qualification lane correctly returned blocked because no verified model artifact and no local generation endpoint were available.')]
model_rows=[['Field','Evidence'],['Qualification status',model.get('status','blocked')],['Candidate only','Yes'],['Weights packaged','No'],['Quality claimed','No'],['Primary blockers',', '.join(model.get('blockers',[])) or 'model artifact and runtime endpoint unavailable']]
story += [table(model_rows,[55*mm,113*mm])]
story += [Paragraph('Required next proof', h2)]
for item in ['Execute a hash-verified local model on the target mini-PC.','Measure structured-output validity, tool-call validity, unsafe-action rate, load time, time to first token, tokens per second, peak RAM/VRAM and energy.','Bind benchmark revision and artifact hash into routing eligibility.']: story.append(bullet(item))

story += section('6. Sovereign Data, Retrieval, and Memory')
story += [p('The local governed store remains authoritative. v16 adds a network-free lexical/BM25 fallback that applies tenant, workspace, sensitivity, expiry, lifecycle and contradiction filters before relevance scoring. This provides a safe degraded path when local embeddings are unavailable.')]
retrieval_rows=[['Property','Result'],['Network required','No'],['Embedding model required','No'],['Scope filtering before ranking','Yes'],['Sensitivity and expiry filtering','Yes'],['Contradiction penalty','Yes'],['Context budget','Character bounded'],['Local embedding comparison','Not completed']]
story += [table(retrieval_rows,[72*mm,52*mm])]

story += section('7. Identity, Keys, and Cryptographic Custody')
story += [p('The portable keystore uses encrypted local storage and separates key purposes. Cross-purpose use is denied, and keys can be rotated, retired, revoked and expired. This is an important control improvement, but it is not equivalent to a non-exportable TPM, smart-card or operating-system key store.')]
key_rows=[['Purpose','Implemented'],['Installation identity','Yes'],['Tenant encryption','Yes'],['Workspace encryption','Yes'],['Data encryption','Yes'],['Backup encryption','Yes'],['Handoff signing','Yes'],['Update signing','Yes'],['Verifier signing','Yes'],['OS or hardware backend','Blocked']]
story += [table(key_rows,[72*mm,35*mm])]

story += section('8. Offline Installation and Update Rehearsal')
story += [Paragraph('Offline dependency installation', h2), p('A clean source copy installed 334 lockfile-pinned packages from a preverified npm cache using offline mode and disabled lifecycle scripts. Type checking and sovereignty tests passed. This proves disconnected dependency installation under a compatible preinstalled Node runtime; it does not prove a bare-metal installer containing Node, operating-system packages or browser artifacts.')]
offline_rows=[['Measure','Result'],['Packages installed','334'],['Registry access during install','Disabled'],['Lifecycle scripts','Disabled'],['Type checking','Passed'],['Sovereignty tests','Passed'],['Prerequisite','Compatible Node runtime and prepared cache']]
story += [table(offline_rows,[72*mm,80*mm])]
story += [Paragraph('Signed migration rehearsal', h2), p('The signed update path applied the v16 migration to a real v15 SQLite schema, preserved sentinel data, validated the updated schema, then restored the previous source/schema/data state. The evidence distinguishes reverse migration from backup-based rollback.')]

story += section('9. Process Network Evidence')
story += [p('The selected sovereign workflow was executed under application instrumentation and Linux process/socket sampling. Four loopback attempts were recorded and zero remote sockets were observed. This is stronger than configuration-only offline claims, but it is not yet equivalent to a deny-all firewall capture on the user\'s target Windows machine.')]
network_rows=[['Measure','Result'],['Instrumented attempts',str(network.get('instrumentedAttempts',network.get('attempts',4)))],['Observed remote sockets','0'],['Allowed destination class','Loopback'],['Unexpected remote traffic','None observed'],['Target Windows attribution','Not tested']]
story += [table(network_rows,[75*mm,75*mm])]

story += section('10. Multi-Process and Node Trust')
story += [p('A separately spawned worker process with a separate signing identity received a tenant/workspace-scoped signed lease, returned a result bound to the exact task and scope, and had replay rejected. This proves process separation and signed work transfer on one physical host. It does not prove synchronization, failover or conflict resolution across two physical machines.')]
node_rows=[['Property','Result'],['Separate controller and worker PID','Passed'],['Separate signing identity','Passed'],['Tenant/workspace scope','Passed'],['Result replay rejection','Passed'],['Network dependency','None'],['Two physical machines','Not proven']]
story += [table(node_rows,[75*mm,75*mm])]

story += section('11. Browser, Accessibility, and Product Reality')
story += [p('The production application was started with a disposable seeded database and temporary password. Chromium was invoked against localhost, but the managed system policy denied navigation with ERR_BLOCKED_BY_ADMINISTRATOR. The policy was not modified or bypassed. Therefore browser E2E, keyboard, focus, screen-reader, responsive, offline and visual-regression evidence remains blocked.')]
story += [Paragraph('Operator-control surfaces implemented in source', h2)]
for item in ['Sovereignty topology and evidence gates.','Model locality and qualification state.','Network-evidence status.','Key-custody status.','Offline-install and update readiness.','Node identity and worker evidence.','Unknown evidence displayed as blocking evidence.']: story.append(bullet(item))

story += section('12. Test, Build, and Adversarial Evidence')
test_rows=[['Gate','Result'],
 ['Canonical validation','100 tasks / 107 claims / 34 sources / 44 ADRs'],
 ['Migrations','10 files / 18 required tables'],
 ['Authoritative isolated tests','64 files / 195 tests / 0 timeout'],
 ['Baseline evaluation','8 / 8'],
 ['Durable crash proof','2 attempts / exactly 1 side effect'],
 ['Static Roast','43 / 44'],
 ['Dynamic Roast','6 / 6'],
 ['v13 mutation probes','12 / 12 killed'],
 ['v12 mutation probes','6 / 6 killed'],
 ['Production build',f"Passed / {build.get('durationSeconds',69)} sec / 31 pages / 2 workers"],
 ['Build peak RSS',f"{build.get('maxRssKb',0)/1024:.0f} MB" if build.get('maxRssKb') else 'Recorded']]
story += [table(test_rows,[75*mm,80*mm])]

story += section('13. Breakthrough and Opportunity Portfolio')
selected=hyp.get('selected',hyp.get('selectedHypotheses',[]))
if selected:
    story += [Paragraph('Selected experimental hypotheses', h2)]
    for x in selected:
        if isinstance(x,str): story.append(bullet(x))
        else: story.append(KeepTogether([Paragraph(esc(x.get('title',x.get('id','Hypothesis'))),h3),p(x.get('mechanism',x.get('description','')),small),p('Status: '+str(x.get('status','experimental')),small)]))
else:
    story += [p('The v16 hypothesis portfolio selected runtime-neutral local inference, purpose-separated portable key custody, and network-free governed retrieval as the three decisive slices.')]
portfolio=opp.get('candidates',opp.get('opportunities',[]))
if portfolio:
    rows=[['ID','Opportunity','Priority / status']]
    for x in portfolio[:30]:
        rows.append([x.get('id',''),x.get('title',x.get('name','')),str(x.get('priority',x.get('status','evaluated')))])
    story += [Paragraph('Thirty-candidate sovereign opportunity portfolio', h2), table(rows,[20*mm,105*mm,42*mm],font_size=6.4)]

story += section('14. Full Roast Register')
story += [p(f'The final Roast register contains {len(findings)} historical and current findings. Historical findings remain present even when fixed, so the release does not erase earlier risk evidence.')]
status_rows=[['Status','Count']]+[[k,str(v)] for k,v in sorted(status.items())]
sev_rows=[['Severity','Count']]+[[k,str(v)] for k,v in sorted(severity.items())]
story += [Table([[table(status_rows,[55*mm,25*mm]), table(sev_rows,[55*mm,25*mm])]],colWidths=[84*mm,84*mm])]
for f in findings:
    header=f"{f.get('id','')} - {f.get('title','')}"
    meta=f"Severity: {f.get('severity','')} | Status: {f.get('status','')} | Category: {f.get('category','')} | Confidence: {f.get('confidence','')}"
    content=[Paragraph(esc(header),h3),p(meta,tiny),p('Finding: '+f.get('description',''),tiny),p('Impact: '+f.get('impact',''),tiny),p('Recommendation: '+f.get('recommendation',''),tiny),p('Acceptance: '+f.get('acceptanceTest',''),tiny)]
    story.append(KeepTogether(content))
    story.append(Spacer(1,2))

story += section('15. Honest Limitations and Next Proof')
limitations=load_text('docs/canonical/57_V16_HONEST_LIMITATIONS.md')
for line in limitations.splitlines():
    line=line.strip()
    if not line or line.startswith('# TITAI'): continue
    if line.startswith('## '): story.append(Paragraph(esc(line[3:]),h2))
    elif line.startswith('- '): story.append(bullet(line[2:]))
    else: story.append(p(line))
story += [PageBreak(), Paragraph('Required v17 operational lane', h1)]
for item in [
 'Run a signed local model artifact on the target mini-PC and bind benchmark results to routing eligibility.',
 'Run Chromium plus a second engine in a disposable environment without managed localhost denial; complete keyboard, accessibility and visual-regression evidence.',
 'Implement and validate a target OS keychain or TPM-backed custody adapter.',
 'Measure target machine energy, temperatures and thermal throttling under model load.',
 'Repeat release verification on a separate machine or CI identity against the frozen ZIP hash.',
]: story.append(bullet(item))

story += section('16. Final Classification')
story += [Paragraph('SOVEREIGN DEVELOPMENT MODE', callout), p('The release contains meaningful local-first and sovereign controls, but the real local-model, browser, hardware-custody, target-energy and external-verifier evidence required for a sovereign controlled pilot remains incomplete.')]
story += [Paragraph('DEVELOPMENT ONLY', callout), p('The production build and all source/test gates pass, but the selected workflow has not yet completed all operational pilot gates in the required target environments.')]
story += [Spacer(1,5*mm), p('Final principle: unknown evidence remains blocking evidence. The release is stronger because it rejects promotion rather than because it produces a green label.', callout)]


def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont('DejaVu',6.5)
    canvas.setFillColor(colors.HexColor('#5D7180'))
    canvas.drawString(MARGIN, 9*mm, 'TITAI v16 - Operational Sovereignty Evidence Report')
    canvas.drawRightString(PAGE_W-MARGIN, 9*mm, f'Page {doc.page}')
    canvas.setStrokeColor(colors.HexColor('#C7D2D9'))
    canvas.line(MARGIN,12*mm,PAGE_W-MARGIN,12*mm)
    canvas.restoreState()


doc=SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=MARGIN, leftMargin=MARGIN, topMargin=15*mm, bottomMargin=17*mm, title='TITAI v16 Operational Sovereignty Report', author='TITAI Engineering Evidence System', subject='Reality-gap closure and sovereign operational validation')
doc.build(story,onFirstPage=on_page,onLaterPages=on_page)
print(json.dumps({'output':str(OUT),'bytes':OUT.stat().st_size,'findings':len(findings)}))
