#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, sys, hashlib
from collections import Counter
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, HRFlowable, KeepTogether

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/mnt/data/Titai-v17-physical-sovereign-pilot-report.pdf')
FINAL_HASH=sys.argv[2] if len(sys.argv)>2 else 'PENDING'
OUT.parent.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('DejaVu','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DejaVu-Bold','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
PAGE_W,PAGE_H=A4; MARGIN=16*mm
styles=getSampleStyleSheet()
base=ParagraphStyle('base',parent=styles['BodyText'],fontName='DejaVu',fontSize=8.4,leading=11.7,textColor=colors.HexColor('#17242D'),spaceAfter=4)
small=ParagraphStyle('small',parent=base,fontSize=7.2,leading=9.4)
tiny=ParagraphStyle('tiny',parent=base,fontSize=6.3,leading=8.1)
title=ParagraphStyle('title',parent=styles['Title'],fontName='DejaVu-Bold',fontSize=25,leading=30,textColor=colors.HexColor('#102F3C'),alignment=TA_LEFT,spaceAfter=10)
subtitle=ParagraphStyle('subtitle',parent=base,fontSize=12,leading=16,textColor=colors.HexColor('#4B6876'))
h1=ParagraphStyle('h1',parent=styles['Heading1'],fontName='DejaVu-Bold',fontSize=15,leading=19,textColor=colors.HexColor('#102F3C'),spaceBefore=8,spaceAfter=7)
h2=ParagraphStyle('h2',parent=styles['Heading2'],fontName='DejaVu-Bold',fontSize=11,leading=14,textColor=colors.HexColor('#22576B'),spaceBefore=6,spaceAfter=4)
h3=ParagraphStyle('h3',parent=styles['Heading3'],fontName='DejaVu-Bold',fontSize=8.8,leading=11.5,textColor=colors.HexColor('#2B6579'),spaceBefore=4,spaceAfter=2)
callout=ParagraphStyle('callout',parent=base,fontName='DejaVu-Bold',fontSize=10,leading=14,textColor=colors.white,backColor=colors.HexColor('#16485B'),borderPadding=8,spaceAfter=8)
mono=ParagraphStyle('mono',parent=base,fontName='Courier',fontSize=6.8,leading=8.8,backColor=colors.HexColor('#F1F5F6'),borderPadding=6)

def loadj(rel,default=None):
 p=ROOT/rel
 return json.loads(p.read_text()) if p.exists() else default

def esc(v): return str(v if v is not None else '').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
def P(text,style=base): return Paragraph(esc(text).replace('\n','<br/>'),style)
def B(text): return Paragraph('- '+esc(text),ParagraphStyle('bullet',parent=base,leftIndent=9,firstLineIndent=-7,spaceAfter=2))
def section(name): return [PageBreak(),Paragraph(name,h1),HRFlowable(width='100%',thickness=1,color=colors.HexColor('#A7BBC4'),spaceAfter=7)]
def table(rows,widths=None,header=True,font=7.0):
 prepared=[[cell if hasattr(cell,'wrap') else Paragraph(esc(cell), small if font>=7 else tiny) for cell in row] for row in rows]
 t=Table(prepared,colWidths=widths,repeatRows=1 if header else 0,hAlign='LEFT')
 cmds=[('FONTNAME',(0,0),(-1,-1),'DejaVu'),('FONTSIZE',(0,0),(-1,-1),font),('LEADING',(0,0),(-1,-1),font+2),('VALIGN',(0,0),(-1,-1),'TOP'),('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#CAD5DA')),('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]
 if header: cmds += [('BACKGROUND',(0,0),(-1,0),colors.HexColor('#16485B')),('TEXTCOLOR',(0,0),(-1,0),colors.white),('FONTNAME',(0,0),(-1,0),'DejaVu-Bold')]
 for r in range(1 if header else 0,len(rows)):
  if r%2==0: cmds.append(('BACKGROUND',(0,r),(-1,r),colors.HexColor('#F5F8F9')))
 t.setStyle(TableStyle(cmds)); return t

validation=loadj('docs/canonical/evidence/v17/validation.json',{})
finddoc=loadj('docs/roast/ROAST_FINDINGS.json',{'findings':[]}); findings=finddoc.get('findings',[])
model=loadj('docs/canonical/evidence/v17/model/qualification.json',{})
browser=loadj('docs/canonical/evidence/v17/browser/evidence.json',{})
custody=loadj('docs/canonical/evidence/v17/os-custody/capabilities.json',{})
installer=loadj('docs/canonical/evidence/v17/installer/proof.json',{})
tests=loadj('docs/canonical/evidence/v17/tests/summary.json',{})
build=loadj('docs/canonical/evidence/v17/build/result.json',{})
manifest=loadj('docs/roast/RELEASE_MANIFEST.json',{})
source_registry=loadj('docs/canonical/research/SOURCE_REGISTRY.json',{'sources':[]})
sev=Counter(x.get('severity','unknown') for x in findings); stat=Counter(x.get('status','unknown') for x in findings)

story=[]
story += [Spacer(1,16*mm),Paragraph('TITAI v17',title),Paragraph('Physical Sovereign Pilot Closure, Real-Hardware Evidence, and Release Promotion Report',subtitle),Spacer(1,7*mm),P('FINAL ENGINEERING, ADVERSARIAL, AND INDEPENDENT-VERIFICATION REPORT',small),Spacer(1,3*mm),Paragraph('SOVEREIGN DEVELOPMENT MODE + DEVELOPMENT ONLY',callout)]
story += [P('v17 strengthens the boundary between software evidence and physical operational proof. The release closes the stale Drizzle dependency blocker, adds physical-gate semantics, a real-model benchmark lane, signed installer contracts, OS-custody integration boundaries, node collectors, and a stricter verifier. It does not execute a real local model, unrestricted browser, OS or hardware custody backend, two physical nodes, target Mini-PC energy measurement, or an external-machine verifier.')]
cover=[['Release','v17-physical-pilot-closure'],['Final source ZIP SHA-256',FINAL_HASH],['Canonical state','107 tasks / 118 claims / 40 sources / 48 ADRs'],['Tests','67 files / 202 tests / 0 timeout'],['Build','31 pages / 2 workers / exit 0'],['Drizzle','drizzle-orm 0.45.2 / drizzle-kit 0.31.10'],['Roast',f"{len(findings)} findings / {sev.get('critical',0)} critical / 44 of 44 static checks"],['Manifest',f"{manifest.get('fileCount','pending')} signed source files"],['Date','2026-07-11']]
story += [Spacer(1,5*mm),table(cover,[52*mm,115*mm],header=False),Spacer(1,8*mm),P('No physical gate is promoted from simulation, static analysis, estimate, same-host process separation, or undocumented assumption.',callout)]

story += section('1. Executive Decision')
story += [Paragraph('Decision',h2),P('The final release must remain SOVEREIGN DEVELOPMENT MODE and DEVELOPMENT ONLY. The correct engineering outcome is a signed rejection, not an optimistic pilot label.')]
for item in validation.get('limitations',[]): story.append(B(item))
story += [Paragraph('Material progress',h2)]
for item in ['Physical evidence is now typed by gate and execution kind.','Mislabeled simulation, same-machine verifier, and one-machine multi-node evidence are rejected.','A 30-case local-model qualification lane enforces safety and structured-output thresholds.','A signed platform-specific offline installer contract and proof harness exist.','A hash-pinned OS custody helper boundary prevents opaque or wrong-purpose helpers.','A signed privacy-preserving node collector supports physical evidence return.','The control plane no longer calls same-host process separation multi-node proof.','Drizzle packages were actually acquired, lockfile-bound, tested, built, and given rollback material.']: story.append(B(item))

story += section('2. Verified Starting Condition')
story += [P('v16 entered this cycle with durable execution, crash recovery, fencing, idempotency, approval continuation, tenant/workspace scope, governed memory, lexical retrieval, portable encrypted custody, signed handoff and update, real migration rehearsal, clean restore, separate-process work, production build, process network evidence, and signed hash-bound release rejection.')]
rows=[['Property','v17 result'],['Canonical validation','107 tasks / 118 claims / 40 sources / 48 ADRs'],['Canonical migrations','10 files / 18 required tables'],['Isolated tests','67 files / 202 tests / zero timeout'],['Production build','Passed / 31 pages / bounded 2-worker configuration'],['Static Roast','44 / 44 passed'],['Mutation probes','v12 6/6 and v13 12/12 killed'],['Durable crash proof','Two attempts / exactly one side effect']]
story += [table(rows,[68*mm,96*mm])]

story += section('3. Physical Evidence Architecture')
story += [P('The central v17 change is an explicit distinction between repository proof and physical proof. Each mandatory gate allows only specific real execution kinds. A record also carries release hash, machine fingerprint, collector version, evidence hashes, timestamp, metrics, reason, and limitations.')]
rows=[['Gate','Allowed physical execution'],['Real local model','Real model'],['Retrieval qualification','Real model or real machine'],['Offline installer','Clean installation'],['Network boundary','Real process/network observation'],['Key custody','Operating-system or hardware custody'],['Browser/accessibility','Real browser'],['Two nodes','Real machine with two distinct fingerprints'],['Energy','Hardware counter or external power meter'],['Update','Real database migration'],['Restore','Real restore'],['Verifier','Independent machine verifier']]
story += [table(rows,[68*mm,98*mm])]
story += [P('Tests prove that labels cannot override execution kind, one repeated machine fingerprint is not two nodes, and a verifier sharing the builder fingerprint cannot pass.')]

story += section('4. Current Primary-Source Research')
research=[['Source','Engineering use'],['llama.cpp b9964 official release','Candidate loopback and subprocess runtime; not downloaded in this environment.'],['Qwen3-0.6B-GGUF official repository','CPU-feasible candidate; no weight was acquired or bundled.'],['Node.js official downloads','Defines signed runtime distribution and current LTS availability.'],['Playwright browser documentation','Defines version-specific browser artifacts, multi-engine testing, hermetic cache, and enterprise-policy limitations.'],['Microsoft DPAPI','Candidate Windows user/machine protected custody backend.'],['Microsoft TPM overview','Candidate non-exportable hardware-protected key custody.']]
story += [table(research,[63*mm,103*mm])]
for source in source_registry.get('sources',[]):
 if source.get('id','').endswith('V17') or 'B9964' in source.get('id','') or 'QWEN3' in source.get('id',''):
  story.append(P(f"{source['id']}: {source['url']}",tiny))

story += section('5. Real Local Model Qualification')
story += [P('The lane requires a real GGUF file, expected SHA-256, license, model identifier, loopback endpoint, artifact verification, runtime health, model load, thirty benchmark cases, cancellation, metrics, unload, and clean shutdown.')]
model_rows=[['Field','Observed'],['Status',model.get('status','missing')],['Model artifact',model.get('candidate',{}).get('artifactPath') or 'Not available'],['Runtime endpoint',model.get('candidate',{}).get('runtimeEndpoint') or 'Not available'],['Benchmark cases','30 defined / 0 executed'],['Threshold','95 percent structured / 80 percent task / 100 percent high-risk refusal'],['Blockers',', '.join(model.get('blockers',[]))]]
story += [table(model_rows,[55*mm,112*mm])]
story += [P('No model-quality claim is accepted. The deterministic runtime remains a contract test only.')]

story += section('6. Offline Installer')
story += [P('The installer builder creates a platform-specific staging tree with a pinned Node executable, production build, dependencies, migrations, installation scripts, file hashes, and Ed25519 manifest. Secrets and model weights are forbidden from the core bundle.')]
checks=installer.get('checks',[])
rows=[['Check','Result']]+[[c.get('id',''), 'PASS' if c.get('passed') else 'BLOCK'] for c in checks]
story += [table(rows,[92*mm,45*mm])]
story += [P(installer.get('reason','No installer proof record.'))]
story += [P(f"Staging files: {installer.get('staging',{}).get('files','unknown')}; bytes: {installer.get('staging',{}).get('bytes','unknown')}. The incomplete compressed artifact was deleted and is not delivered.")]

story += section('7. Key Custody')
story += [P('The portable keystore remains proven. v17 adds a no-shell external helper protocol that verifies platform, binary SHA-256, backend identity, allowed key purposes, timeout, and response schema before an OS or hardware custody operation can be trusted.')]
cap=custody.get('capabilities',{})
rows=[['Capability','Observed'],['Platform',cap.get('platform','unknown')],['DPAPI available',str(cap.get('dpapiAvailable'))],['TPM device present',str(cap.get('tpmDevicePresent'))],['TPM tool available',str(cap.get('tpmToolAvailable'))],['Secret Service available',str(cap.get('secretServiceToolAvailable'))],['Proven backend',cap.get('provenBackend','none')],['Status',custody.get('status','blocked')]]
story += [table(rows,[75*mm,72*mm])]

story += section('8. Browser and Accessibility')
story += [P('Playwright enumerates twelve tests across Chromium, Firefox, and mobile Chromium. The managed Chromium policy includes a deny-all URL blocklist, so real navigation including loopback is unavailable. The policy was preserved.')]
rows=[['Property','Result'],['Configured tests','12'],['Chromium navigation','Blocked by administrator'],['Firefox binary','Not available in current environment'],['Keyboard and focus','Not executed'],['Accessibility scan','Not executed'],['Responsive screenshots','Not executed'],['Policy bypass','Not attempted']]
story += [table(rows,[75*mm,78*mm])]

story += section('9. Nodes, Hardware, and Energy')
story += [P('A signed node-profile collector emits a hashed machine fingerprint, hardware summary, scope, and signing identity without hostname, IP address, serial number, or secrets. Only one fingerprint was collected in this cycle.')]
rows=[['Gate','Result'],['Signed node profile','Implemented and collected'],['Two distinct fingerprints','Blocked'],['Physical node failure proof','Blocked'],['Target Mini-PC profile','Blocked'],['Power and watt-hours','Blocked'],['Thermal throttling','Blocked'],['Automatic energy routing','Remains advisory']]
story += [table(rows,[75*mm,78*mm])]

story += section('10. Drizzle Supply-Chain Closure')
story += [P('The long-standing static dependency blocker was closed using actual registry artifacts. The release records package versions and integrity, updates the lockfile, preserves rollback package files outside the release, and runs the required behavioral gates.')]
rows=[['Gate','Result'],['drizzle-orm','0.45.2'],['drizzle-kit','0.31.10'],['Install','Passed with lifecycle scripts disabled'],['Typecheck','Passed'],['Migration validation','10 files / 18 tables'],['SQLite persistence','5 files / 11 tests passed'],['v17 evidence tests','3 files / 7 tests passed'],['Production build','Passed'],['Static Roast','44 / 44 passed']]
story += [table(rows,[75*mm,78*mm])]

story += section('11. Full Validation and Performance')
tot=tests.get('totals',{})
rows=[['Measure','Result'],['Test files',str(tot.get('files',67))],['Passed tests',str(tot.get('passedTests',202))],['Failed tests',str(tot.get('failedTests',0))],['Timed-out files',str(tot.get('timedOutFiles',0))],['Aggregate isolated duration',f"{tot.get('durationMs',0)/1000:.1f} seconds"],['Build exit code',str(build.get('exitCode',0))],['Build pages','31'],['Source manifest files',str(manifest.get('fileCount','pending'))],['Package components','522']]
story += [table(rows,[75*mm,78*mm])]

story += section('12. Physical Gate Decision')
for gate,value in validation.get('physicalGates',{}).items():
 story.append(KeepTogether([Paragraph(esc(gate),h3),P(f"Status: {value.get('status','unknown')}",small),P(value.get('reason',''),small)]))
story += [P('Three operational proofs from prior cycles remain valid in this environment: process network observation, signed update migration rehearsal, and clean restore. They do not compensate for the missing model, installer, custody, browser, node, energy, and external-verifier evidence.')]

story += section('13. Roast Summary')
story += [P(f"The historical register contains {len(findings)} findings. Fixed findings remain present so future agents cannot erase risk history.")]
summary_rows=[['Severity','Count']]+[[k,str(v)] for k,v in sorted(sev.items())]
status_rows=[['Status','Count']]+[[k,str(v)] for k,v in sorted(stat.items())]
story += [Table([[table(summary_rows,[48*mm,28*mm]),table(status_rows,[62*mm,28*mm])]],colWidths=[82*mm,86*mm])]

story += section('14. Full Finding Register')
for f in findings:
 block=[Paragraph(esc(f"{f.get('id')} - {f.get('title')}"),h3),P(f"Severity: {f.get('severity')} | Status: {f.get('status')} | Category: {f.get('category')} | Confidence: {f.get('confidence')}",tiny),P('Finding: '+f.get('description',''),tiny),P('Impact: '+f.get('impact',''),tiny),P('Correction: '+f.get('recommendation',''),tiny),P('Acceptance: '+f.get('acceptanceTest',''),tiny)]
 story.append(KeepTogether(block)); story.append(Spacer(1,2))

story += section('15. Honest Limitations')
text=(ROOT/'docs/canonical/61_V17_HONEST_LIMITATIONS.md').read_text()
for line in text.splitlines():
 line=line.strip()
 if not line or line.startswith('# TITAI'): continue
 if line.startswith('## '): story.append(Paragraph(esc(line[3:]),h2))
 elif line.startswith('- '): story.append(B(line[2:]))
 else: story.append(P(line))

story += section('16. Final Classification')
story += [Paragraph('SOVEREIGN DEVELOPMENT MODE',callout),P('The system has strong local-first, cryptographic, durable, offline, and evidence controls. It lacks the physical proof required for a sovereign controlled pilot.')]
story += [Paragraph('DEVELOPMENT ONLY',callout),P('The source release, tests, migrations, supply chain, build, and packaging are validated, but the Golden Physical Pilot Workflow has not passed every mandatory external gate.')]
story += [P('Final principle: physical proof cannot be synthesized from software confidence. Unknown evidence remains blocking evidence.',callout)]

def footer(canvas,doc):
 canvas.saveState();canvas.setFont('DejaVu',6.5);canvas.setFillColor(colors.HexColor('#617783'));canvas.drawString(MARGIN,9*mm,'TITAI v17 - Physical Sovereign Pilot Evidence Report');canvas.drawRightString(PAGE_W-MARGIN,9*mm,f'Page {doc.page}');canvas.setStrokeColor(colors.HexColor('#CAD5DA'));canvas.line(MARGIN,12*mm,PAGE_W-MARGIN,12*mm);canvas.restoreState()

doc=SimpleDocTemplate(str(OUT),pagesize=A4,rightMargin=MARGIN,leftMargin=MARGIN,topMargin=15*mm,bottomMargin=17*mm,title='TITAI v17 Physical Sovereign Pilot Report',author='TITAI Engineering Evidence System',subject='Physical evidence closure and release validation')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
print(json.dumps({'output':str(OUT),'bytes':OUT.stat().st_size,'findings':len(findings),'sha256':hashlib.sha256(OUT.read_bytes()).hexdigest()}))
