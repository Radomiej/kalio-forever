"""Summarize an exploratory run without mixing cold/warm task latencies."""
import json,pathlib,collections
root=pathlib.Path(__file__).resolve().parent
rows=[json.loads(line)for line in(root/'results.jsonl').read_text().splitlines()]
groups=collections.defaultdict(list)
for row in rows:groups[(row['model'],row['group'],row['condition'])].append(row)
result=[]
for (model,group,condition),items in groups.items():
 record={'model':model,'group':group,'condition':condition,'passed':sum(bool(r['passed'])for r in items),'trials':len(items),'correct_fields':sum(r.get('correct_fields',0)for r in items),'total_fields':sum(r.get('total_fields',0)for r in items),'tasks':[]}
 for row in items:
  response=row.get('response',{})
  record['tasks'].append({'task':row['task'],'passed':row['passed'],'prompt_tokens':response.get('prompt_eval_count'),'wall_s':response.get('wall_s'),'ttft_s':response.get('ttft_s'),'prefill_s':(response.get('prompt_eval_duration')or 0)/1e9,'load_s':(response.get('load_duration')or 0)/1e9,'done_reason':response.get('done_reason'),'error':row.get('error')})
 result.append(record)
(root/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
for x in result:print(x['model'],x['group'],x['condition'],f"{x['passed']}/{x['trials']} tasks",f"{x['correct_fields']}/{x['total_fields']} fields",[(t['task'],t['prompt_tokens'],round(t['wall_s']or 0,2))for t in x['tasks']])
