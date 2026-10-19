import pathlib,json,statistics,math,collections
R=pathlib.Path(__file__).resolve().parent;unique={}
source=R/'reviewed-results.jsonl' if (R/'reviewed-results.jsonl').exists() else R/'results.jsonl'
for l in source.read_text().splitlines():
 x=json.loads(l);unique[(x['model'],x['repeat'],x['task'])]=x
from benchmark import TASKS,grade
tasks={t[0]:t for t in TASKS}
for key,row in unique.items():
 if row['task'] in ['pl_read','en_read'] and 'response' in row:
  row['passed'],row['grade_detail']=grade(tasks[row['task']],row['response'])
overrides=R/'manual-overrides.json'
if overrides.exists():
 for o in json.loads(overrides.read_text()):
  key=(o['model'],o['repeat'],o['task'])
  if key in unique:unique[key]={**unique[key],'passed':o['passed'],'manual_review':o['reason']}
models=list(dict.fromkeys(x['model'] for x in unique.values()));out=[]
for model in models:
 rows=[x for x in unique.values() if x['model']==model];valid=[x for x in rows if 'response' in x];calls=[x['response'] for x in valid]+[x['followup'] for x in valid if 'followup' in x];dur=sum(x.get('eval_duration') or 0 for x in calls)/1e9;tokens=sum(x.get('eval_count') or 0 for x in calls)
 wall=sorted(x['wall_s'] for x in rows if 'wall_s' in x);tt=[x['response']['ttft_s'] for x in valid if x['response']['ttft_s'] is not None]
 obj={'model':model,'trials':len(rows),'passed':sum(x.get('passed',False) for x in rows),'category':{},'median_s':statistics.median(wall) if wall else None,'p95_s':wall[math.ceil(.95*len(wall))-1] if wall else None,'median_ttft_s':statistics.median(tt) if tt else None,'generation_tokens_per_s':tokens/dur if dur else None,'errors':[x for x in rows if 'error' in x]}
 for c in ['pl','en','tools','code']:
  rs=[x for x in rows if x['category']==c];ts=[x['wall_s'] for x in rs if 'wall_s' in x];obj['category'][c]={'passed':sum(x.get('passed',False) for x in rs),'trials':len(rs),'median_s':statistics.median(ts) if ts else None}
 for kind in ['memory','cold']:
  p=R/(model.replace(':','_')+'-'+kind+'.json')
  if p.exists():
   v=json.loads(p.read_text());obj[kind]=v if kind=='memory' else {k:v.get(k) for k in ['wall_s','ttft_s','load_duration']}
 out.append(obj)
(R/'summary.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
for x in out:print(x['model'],x['passed'],'/',x['trials'],{k:(v['passed'],v['trials']) for k,v in x['category'].items()},'median',round(x['median_s'] or 0,2),'TTFT',round(x['median_ttft_s'] or 0,2),'tok/s',round(x['generation_tokens_per_s'] or 0,2))
