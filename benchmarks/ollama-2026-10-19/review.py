import json,pathlib
from benchmark import TASKS,grade,tool_valid,tool_answer_ok
R=pathlib.Path(__file__).resolve().parent;tasks={x[0]:x for x in TASKS};overrides={(x['model'],x['repeat'],x['task']):x for x in json.loads((R/'manual-overrides.json').read_text())};rows=[]
for l in (R/'results.jsonl').read_text().splitlines():
 x=json.loads(l);key=(x['model'],x['repeat'],x['task']);old=x.get('passed')
 if 'response' in x and x['category']!='tools':x['passed'],x['grade_detail']=grade(tasks[x['task']],x['response'])
 if x['category']=='tools' and 'response' in x:
  x['tool_call_correct']=tool_valid(x['response']['tool_calls'],tasks[x['task']][3]);x['passed']=x['tool_call_correct'] and 'followup' in x and tool_answer_ok(x['followup']['content'],tasks[x['task']][3]) and not x['followup']['tool_calls']
 if key in overrides:x['passed']=overrides[key]['passed'];x['manual_review']=overrides[key]['reason']
 if x.get('passed')!=old:print('REVIEW CHANGE',key,old,'->',x.get('passed'),x.get('manual_review') or x.get('grade_detail'))
 rows.append(x)
(R/'reviewed-results.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows));print('Reviewed',len(rows),'trials')
