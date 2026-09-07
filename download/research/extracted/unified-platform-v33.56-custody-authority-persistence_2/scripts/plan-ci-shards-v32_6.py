#!/usr/bin/env python3
import json,os,sys,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent));import test_ops_context_v32_6 as ctx
ROOT=ctx.ROOT;OUT=ctx.run_dir();cfg=json.loads((ROOT/'config/test-operations-v32_6.json').read_text());profile=json.loads((OUT/'V32_6_TEST_FILE_PROFILE.json').read_text());rows=profile['rows'];serial=sum(float(r['executionWallMs'])for r in rows);d=cfg['distributedSharding'];patterns=cfg.get('exclusiveShardPatterns',[])
def exclusive(r):return any(p in r['file']for p in patterns)
exclusive_rows=[r for r in rows if exclusive(r)];regular=[r for r in rows if not exclusive(r)];base=max(d['minimumShards'],math.ceil(sum(float(r['executionWallMs'])for r in regular)/d['targetSerialMsPerShard']));count=min(d['maximumShards'],base+len(exclusive_rows));
if len(exclusive_rows)>=count:raise SystemExit('insufficient_shards_for_exclusive_tests')
shards=[{'index':i,'files':[],'estimatedMs':0.0,'resources':set(),'exclusive':False}for i in range(count)]
for i,r in enumerate(sorted(exclusive_rows,key=lambda x:x['file'])):
 s=shards[i];s['files'].append(r['file']);s['estimatedMs']+=r['executionWallMs'];s['resources']|=set(r.get('resources',[]));s['exclusive']=True
targets=shards[len(exclusive_rows):]
for r in sorted(regular,key=lambda x:(-x['executionWallMs'],x['file'])):
 rs=set(r.get('resources',[]));compatible=[s for s in targets if not rs&s['resources']];target=min(compatible or targets,key=lambda s:(s['estimatedMs'],s['index']));target['files'].append(r['file']);target['estimatedMs']+=r['executionWallMs'];target['resources']|=rs
plan=[{'index':s['index'],'files':sorted(Path(f).stem.removesuffix('.test')for f in s['files']),'estimatedMs':round(s['estimatedMs'],3),'resources':sorted(s['resources']),'exclusive':s['exclusive']}for s in shards];identity=ctx.execution_identity();critical=max(x['estimatedMs']for x in plan);eff=serial/(critical*count)if critical else 1;regular_critical=max((x['estimatedMs']for x in plan if not x['exclusive']),default=0);regular_serial=sum(x['estimatedMs']for x in plan if not x['exclusive']);regular_count=sum(not x['exclusive']for x in plan);regular_eff=regular_serial/(regular_critical*regular_count)if regular_critical and regular_count else 1;report={'version':'32.9','runId':OUT.name,'status':'passed',**identity,'shardCount':count,'serialEstimatedMs':round(serial,3),'criticalPathEstimatedMs':critical,'planningEfficiency':round(eff,4),'regularPlanningEfficiency':round(regular_eff,4),'exclusiveShardFiles':[Path(r['file']).stem.removesuffix('.test')for r in exclusive_rows],'shards':plan};ctx.atomic_write_json(OUT/'V32_6_CI_SHARD_PLAN.json',report);matrix={'include':[{'shard_index':x['index'],'shard_count':count}for x in plan]};print(json.dumps(matrix));github=os.getenv('GITHUB_OUTPUT');
if github:
 with open(github,'a')as f:f.write('shard_matrix='+json.dumps(matrix,separators=(',',':'))+'\n');f.write(f'shard_count={count}\n')
