import json,time,urllib.request,pathlib,subprocess,re,sys,resource
ROOT=pathlib.Path(__file__).resolve().parent;BASE='http://127.0.0.1:11434'
def api(path,data=None,timeout=240):
 req=urllib.request.Request(BASE+path,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=timeout))
def tool(n,p):return {'type':'function','function':{'name':n,'description':n.replace('_',' '),'parameters':{'type':'object','properties':p,'required':list(p),'additionalProperties':False}}}
TOOLS=[tool('get_weather',{'city':{'type':'string'}}),tool('calculate',{'a':{'type':'number'},'b':{'type':'number'}}),tool('lookup_order',{'order_id':{'type':'string'}})]
TASKS=[
('pl_extract','pl','Zwróć wyłącznie JSON z kluczami miasto, data, liczba. Tekst: Spotkanie w Łodzi odbędzie się 21 listopada 2026 roku. Przyjdzie siedem osób. Datę zapisz YYYY-MM-DD.',{'miasto':'Łódź','data':'2026-11-21','liczba':7}),
('pl_reason','pl','W pudełku było 18 kredek. Ola zabrała jedną trzecią, a potem dołożyła 5. Ile kredek jest teraz w pudełku? Odpowiedz wyłącznie liczbą.',17),
('pl_read','pl','Regulamin: Bezpłatny zwrot jest możliwy do 14 dni od odbioru, wyłącznie dla towaru nieużywanego. Marta odebrała produkt 3 maja i użyła go 4 maja. Zgłasza zwrot 10 maja. Czy przysługuje jej bezpłatny zwrot zgodnie z regulaminem? Zwróć wyłącznie JSON: {"zwrot": true/false, "powod": krótki powód po polsku}.',False),
('en_extract','en','Return only JSON with keys city, date, count. Text: Seven people will attend the meeting in Leeds on November 21, 2026. Use YYYY-MM-DD.',{'city':'Leeds','date':'2026-11-21','count':7}),
('en_reason','en','A box held 24 pencils. Ben removed one quarter and then added 3. How many pencils are in the box now? Answer only with the number.',21),
('en_read','en','Policy: Free returns within 14 days of delivery, only for unused goods. Jane received an item on May 3 and used it on May 4. She requests a return on May 10. Is she eligible? Return only JSON: {"eligible": true/false, "reason": a short reason in English}.',False),
('tools_pl','tools','Sprawdź aktualną pogodę w Warszawie, używając odpowiedniego narzędzia. Po wyniku podaj temperaturę i warunki po polsku.',{'name':'get_weather','args':{'city':'Warszawa'},'result':{'temperature_c':17,'condition':'deszcz'},'answer':'17'}),
('tools_en','tools','Use the calculation tool to multiply 37 by 19. Then give the numerical result.',{'name':'calculate','args':{'a':37,'b':19},'result':{'result':703},'answer':'703'}),
('tools_order','tools','Check the status of order PL-204 using the order lookup tool, then report its status.',{'name':'lookup_order','args':{'order_id':'PL-204'},'result':{'status':'shipped','tracking':'TEST123'},'answer':'shipped'}),
('code_unique','code','Write Python function unique_keep_order(items) returning distinct hashable items in first-occurrence order. Return only Python code, no markdown or explanations.',"assert unique_keep_order([3,1,3,2,1])==[3,1,2]\nassert unique_keep_order([])==[]\nassert unique_keep_order(['ą','b','ą'])==['ą','b']\nassert unique_keep_order([0,False,1,True])==[0,1]"),
('code_intervals','code','Napisz funkcję Python merge_intervals(intervals), która scala nakładające się lub stykające przedziały [start,end] i zwraca posortowaną listę list. Puste wejście daje []. Nie modyfikuj wejścia. Zwróć wyłącznie kod Python, bez markdown.',"assert merge_intervals([[5,7],[1,3],[3,6]])==[[1,7]]\nassert merge_intervals([])==[]\nassert merge_intervals([[4,5],[1,2]])==[[1,2],[4,5]]\na=[[5,7],[1,3]]; b=[x[:] for x in a]; merge_intervals(a); assert a==b\nassert merge_intervals([[1,8],[2,3]])==[[1,8]]\na=[[1,3],[2,5]]; b=[x[:] for x in a]; merge_intervals(a); assert a==b"),
('code_fix','code','Fix this Python function to return the index of the first matching element in a sorted list, or -1 if absent. Keep O(log n). Return only corrected Python code.\ndef first_index(a, target):\n lo, hi = 0, len(a)-1\n while lo < hi:\n  mid=(lo+hi)//2\n  if a[mid] < target: lo=mid+1\n  else: hi=mid-1\n return lo',"assert first_index([],1)==-1\nassert first_index([1],1)==0\nassert first_index([1],2)==-1\nassert first_index([1,2,2,2,4],2)==1\nassert first_index([1,3,5],4)==-1\nassert first_index([1,3,5],5)==2\nassert first_index([1,3,5],0)==-1")]
def chat(model,messages,tools=None,thinking=False,max_tokens=384):
 if model=='lfm2.5:8b':thinking=True;max_tokens=max(max_tokens,1536)
 data={'model':model,'messages':messages,'stream':True,'think':thinking,'keep_alive':'20m','options':{'temperature':0,'seed':42,'num_ctx':4096,'num_predict':max_tokens,'num_thread':4}}
 if tools:data['tools']=tools
 req=urllib.request.Request(BASE+'/api/chat',data=json.dumps(data).encode(),headers={'Content-Type':'application/json'})
 t=time.monotonic();first=None;content='';thinking='';calls=[];last={}
 with urllib.request.urlopen(req,timeout=240) as r:
  for line in r:
   p=json.loads(line)
   if p.get('error'):raise RuntimeError(p['error'])
   m=p.get('message',{});c=m.get('content','');th=m.get('thinking','');tc=m.get('tool_calls',[])
   if first is None and (c or th or tc):first=time.monotonic()-t
   content+=c;thinking+=th;calls.extend(tc);last=p
 return {'wall_s':time.monotonic()-t,'ttft_s':first,'content':content,'thinking':thinking,'tool_calls':calls,**{k:last.get(k) for k in ['load_duration','prompt_eval_count','prompt_eval_duration','eval_count','eval_duration','done_reason']}}
def strip(s):return re.sub(r'^```(?:json|python)?\s*|\s*```$','',s.strip())
def limits():
 resource.setrlimit(resource.RLIMIT_CPU,(2,2));resource.setrlimit(resource.RLIMIT_AS,(256*1024**2,256*1024**2));resource.setrlimit(resource.RLIMIT_FSIZE,(1024**2,1024**2))
def grade(task,r):
 id,cat,p,e=task;s=r['content'].strip()
 try:
  if cat=='code':
   x=subprocess.run([sys.executable,'-I','-S','-c',strip(s)+'\n'+e],capture_output=True,text=True,timeout=4,preexec_fn=limits,cwd='/tmp',env={'PATH':'/usr/bin:/bin'})
   return x.returncode==0,x.stderr[-1200:]
  if id.endswith('extract'):return json.loads(strip(s))==e,''
  if id.endswith('reason'):return s==str(e),''
  o=json.loads(strip(s));key,reason=('zwrot','powod') if cat=='pl' else ('eligible','reason')
  reason_text=str(o.get(reason,'')).casefold()
  justified=('uży' in reason_text) if cat=='pl' else bool(re.search(r'\bused\b|\buse\b|not unused',reason_text))
  return o.get(key) is False and justified,'Eligibility must be false and the reason must identify prior use.'
 except Exception as x:return False,str(x)
def tool_valid(calls,e):
 if len(calls)!=1 or calls[0]['function']['name']!=e['name']:return False
 a=calls[0]['function']['arguments']
 if e['name']=='get_weather':return set(a)=={'city'} and a['city'].strip().casefold() in {'warszawa','warsaw'}
 if e['name']=='calculate':return set(a)=={'a','b'} and sorted([a['a'],a['b']])==[19,37]
 return a==e['args']
def tool_answer_ok(text,e):
 text=text.casefold()
 if e['name']=='get_weather':return bool(re.search(r'\b17\b',text)) and ('deszcz' in text or 'opad' in text)
 if e['name']=='calculate':return bool(re.search(r'\b703\b',text))
 return any(v in text for v in ['shipped','dispatched','has been sent','on its way'])
def run(model):
 print('MODEL',model,flush=True); meta=api('/api/show',{'model':model});(ROOT/(model.replace(':','_')+'-metadata.json')).write_text(json.dumps(meta,ensure_ascii=False,indent=2))
 api('/api/generate',{'model':model,'keep_alive':0});cold=chat(model,[{'role':'user','content':'Reply only: READY'}]);(ROOT/(model.replace(':','_')+'-cold.json')).write_text(json.dumps(cold,indent=2))
 done=set()
 if (ROOT/'results.jsonl').exists():
  for line in (ROOT/'results.jsonl').read_text().splitlines():
   v=json.loads(line)
   if 'error' not in v:done.add((v['model'],v['repeat'],v['task']))
 (ROOT/(model.replace(':','_')+'-memory.json')).write_text(json.dumps(api('/api/ps'),indent=2))
 for rep in range(2):
  for task in TASKS:
   id,cat,p,e=task
   if (model,rep+1,id) in done:continue
   row={'model':model,'repeat':rep+1,'task':id,'category':cat,'prompt':p,'profile':{'think':model=='lfm2.5:8b','max_tokens':1536 if model=='lfm2.5:8b' else 384}}
   try:
    msgs=[{'role':'user','content':p}];r=chat(model,msgs,TOOLS if cat=='tools' else None);row['response']=r;row['wall_s']=r['wall_s']
    if cat=='tools':
     calls=r['tool_calls'];valid=tool_valid(calls,e);row['tool_call_correct']=valid
     if valid:
      msgs+=[{'role':'assistant','content':r['content'],'tool_calls':calls},{'role':'tool','tool_name':e['name'],'content':json.dumps(e['result'])}]
      r2=chat(model,msgs,TOOLS);row['followup']=r2;row['passed']=tool_answer_ok(r2['content'],e) and not r2['tool_calls'];row['wall_s']+=r2['wall_s']
     else:row['passed']=False
    else:row['passed'],row['grade_detail']=grade(task,r)
   except Exception as x:row['passed']=False;row['error']=str(x)
   with (ROOT/'results.jsonl').open('a') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
   print(model,rep+1,id,row['passed'],round(row.get('wall_s',0),2),row.get('error',''),flush=True)
 api('/api/generate',{'model':model,'keep_alive':0})
if __name__=='__main__':
 for model in sys.argv[1:]:run(model)
