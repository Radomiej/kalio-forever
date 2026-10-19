import json,time,urllib.request,pathlib,random,re,sys
ROOT=pathlib.Path(__file__).resolve().parent
BASE='http://127.0.0.1:11434'
ALL=json.load(open(ROOT/'tool-catalog.json'))
def schemas(names=None):
 return [{'type':'function','function':{k:t[k] for k in ['name','description','parameters']}} for t in ALL if names is None or t['name'] in names]
BASIC=['vfs_write','vfs_read','vfs_list','vfs_grep_search','list_tools','get_tool_details']
def api(path,data):
 req=urllib.request.Request(BASE+path,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=900))
def chat(model,msgs,tools=None,ctx=32768):
 d={'model':model,'messages':msgs,'stream':True,'think':model.startswith('lfm'),'keep_alive':'15m','options':{'num_ctx':ctx,'temperature':0,'seed':42,'num_thread':4,'num_predict':1536 if model.startswith('lfm') else 384}}
 if tools:d['tools']=tools
 req=urllib.request.Request(BASE+'/api/chat',data=json.dumps(d).encode(),headers={'Content-Type':'application/json'});start=time.monotonic();first=None;content='';thinking='';calls=[];last={}
 with urllib.request.urlopen(req,timeout=900) as r:
  for line in r:
   p=json.loads(line)
   if 'error'in p:raise RuntimeError(p['error'])
   m=p.get('message',{});c=m.get('content','');th=m.get('thinking','');tc=m.get('tool_calls',[])
   if first is None and(c or th or tc):first=time.monotonic()-start
   content+=c;thinking+=th;calls.extend(tc);last=p
 return {'wall_s':time.monotonic()-start,'ttft_s':first,'content':content,'thinking':thinking,'tool_calls':calls,**{k:last.get(k) for k in ['load_duration','prompt_eval_count','prompt_eval_duration','eval_count','eval_duration','done_reason']}}
def clean(s):return re.sub(r'^```(?:json)?\s*|\s*```$','',s.strip())
def runrow(model,group,condition,task,msgs,expected,tools=None,ctx=32768):
 key=(model,group,condition,task)
 if key in done:return
 row={'model':model,'group':group,'condition':condition,'task':task,'num_ctx':ctx,'tools_count':len(tools or []),'expected':expected,'messages':msgs}
 try:
  row['response']=r=chat(model,msgs,tools,ctx)
  if group=='tools':
   tc=r['tool_calls'];row['passed']=len(tc)==1 and tc[0]['function']['name']==expected['name'] and tc[0]['function']['arguments']==expected['args'];row['correct_fields']=int(row['passed']);row['total_fields']=1
  else:
   try:o=json.loads(clean(r['content']))
   except (ValueError,TypeError):o={}
   row['correct_fields']=sum(o.get(k)==v for k,v in expected.items());row['total_fields']=len(expected);row['passed']=o==expected
 except Exception as e:row['error']=str(e);row['passed']=False
 with (ROOT/'results.jsonl').open('a')as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
 print(model,group,condition,task,row['passed'],round(row.get('response',{}).get('wall_s',0),2),row.get('response',{}).get('prompt_eval_count'),row.get('error',''),flush=True)
def doc(n):
 rng=random.Random(431);rows=[];targets={0:('ALFA','K7M9',17),n//2:('BETA','R4Z2',31),n-1:('GAMMA','P8V6',23)}
 for i in range(n):
  if i in targets:name,code,units=targets[i]
  else:name=f'ITEM-{i:05}';code=''.join(rng.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789')for _ in range(4));units=rng.randrange(1,99)
  rows.append(f'Record {i:05}: name={name}; code={code}; units={units}.')
 return '\n'.join(rows)
done=set()
if(ROOT/'results.jsonl').exists():
 for l in(ROOT/'results.jsonl').read_text().splitlines():
  x=json.loads(l)
  if'error'not in x:done.add((x['model'],x['group'],x['condition'],x['task']))
if __name__=='__main__':
 for model in [arg for arg in sys.argv[1:] if not arg.startswith('--')] or ['qwen3.5:2b','lfm2.5:8b']:
  if '--focused-only' not in sys.argv:
   for ctx in [4096,32768]:
    api('/api/generate',{'model':model,'keep_alive':0})
    runrow(model,'capacity',str(ctx),'short_pl',[{'role':'user','content':'Zwróć tylko JSON: miasto, data, liczba. Spotkanie w Łodzi: 21 listopada 2026, siedem osób. Data YYYY-MM-DD.'}],{'miasto':'Łódź','data':'2026-11-21','liczba':7},ctx=ctx)
   for label,tools in [('basic6',schemas(BASIC)),('all62',schemas())]:
    api('/api/generate',{'model':model,'keep_alive':0})
    system={'role':'system','content':'Use the appropriate provided tool. Preserve literal values exactly. Do not claim an operation succeeded before its result.'}
    runrow(model,'tools',label,'write_pl',[system,{'role':'user','content':'Zapisz w VFS plik notes/proba.txt o dokładnej treści: Zażółć gęślą jaźń. Użyj narzędzia zapisu.'}],{'name':'vfs_write','args':{'filePath':'notes/proba.txt','content':'Zażółć gęślą jaźń.'}},tools)
    runrow(model,'tools',label,'read_en',[system,{'role':'user','content':'Read the file notes/input.txt from the conversation virtual filesystem using its read tool.'}],{'name':'vfs_read','args':{'filePath':'notes/input.txt'}},tools)
   for n in [40,300,800]:
    api('/api/generate',{'model':model,'keep_alive':0})
    system={'role':'system','content':'Answer using only the supplied records. Return only JSON with exactly the requested keys. Do not invent facts.\nRECORDS:\n'+doc(n)}
    runrow(model,'filled_context',f'{n}_records','recall_pl',[system,{'role':'user','content':'Podaj kody rekordów ALFA, BETA i GAMMA. Klucze JSON: ALFA, BETA, GAMMA.'}],{'ALFA':'K7M9','BETA':'R4Z2','GAMMA':'P8V6'})
    runrow(model,'filled_context',f'{n}_records','join_en',[system,{'role':'user','content':'Return the sum of units for ALFA and BETA, and the code of GAMMA. JSON keys: total_units, gamma_code.'}],{'total_units':48,'gamma_code':'P8V6'})
  system={'role':'system','content':'Answer using only the supplied records. Return only JSON with exactly the requested keys. Do not invent facts.\nRECORDS:\n'+doc(3)}
  runrow(model,'focused_context','oracle_3_records','recall_pl',[system,{'role':'user','content':'Podaj kody rekordów ALFA, BETA i GAMMA. Klucze JSON: ALFA, BETA, GAMMA.'}],{'ALFA':'K7M9','BETA':'R4Z2','GAMMA':'P8V6'})
  runrow(model,'focused_context','oracle_3_records','join_en',[system,{'role':'user','content':'Return the sum of units for ALFA and BETA, and the code of GAMMA. JSON keys: total_units, gamma_code.'}],{'total_units':48,'gamma_code':'P8V6'})
  api('/api/generate',{'model':model,'keep_alive':0})
