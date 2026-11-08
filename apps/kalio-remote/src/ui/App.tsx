import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, Check, ChevronDown, CircleHelp, GitBranch, Layers, Link2, Moon, Search, ShieldAlert, Sun, X } from 'lucide-react';
import { Approval, SessionSnapshot, Snapshot } from '../protocol';
import { pairRelay, RelayClient, RelayEvent } from '../client/RelayClient';

type View = 'sessions' | 'approvals' | 'graph';
type Connection = { id: string; name: string; client: RelayClient; snapshot: Snapshot | null; online: boolean };
const fixture: Snapshot = { instance: { id: 'preview-instance', name: 'Studio workstation' }, sessions: [
 { id: 's1', title: 'Review authentication flow', active: true, project: 'kalio-web', persona: 'Architect', updatedAt: '2026-11-08T12:22:00Z' },
 { id: 's2', title: 'Mobile relay design', active: false, project: 'remote-client', persona: 'Developer', updatedAt: '2026-11-08T11:41:00Z' },
 { id: 's3', title: 'Inspect child task', active: true, project: 'kalio-api', persona: 'Researcher', parentSessionId: 's1', updatedAt: '2026-11-08T11:35:00Z' }
], approvals: [{ id:'a1', sessionId:'s1', toolName:'filesystem.read', args:{ path:'apps/kalio-web/src/auth/session.ts', reason:'Inspect token refresh handling' }, revision:'rev-42', argsSha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', requestedAt:'2026-11-08T12:24:00Z' }] };
const previewSession: SessionSnapshot = { sessionId: 's1', messages: [
 { id:'m1', role:'user', content:'Trace the refresh flow and identify where the session expires.', createdAt:'2026-11-08T12:20:00Z' },
 { id:'m2', role:'assistant', content:'I’m following the token refresh path and checking its expiration handling.', createdAt:'2026-11-08T12:21:00Z' },
 { id:'m3', role:'assistant', content:'The session module is open for read-only inspection.', createdAt:'2026-11-08T12:22:00Z' }
], graph:{ nodes:[{id:'n1',type:'prompt',label:'User request',status:'complete'},{id:'n2',type:'agent',label:'Trace refresh flow',status:'running'},{id:'n3',type:'tool',label:'Read session.ts',status:'waiting'}], edges:[{id:'e1',source:'n1',target:'n2',type:'flow'},{id:'e2',source:'n2',target:'n3',type:'tool'}] } };

export function App() {
 const [connections, setConnections] = useState<Connection[]>([]);
 const [selected, setSelected] = useState<string>('');
 const [view, setView] = useState<View>('sessions');
 const [session, setSession] = useState<SessionSnapshot | null>(null);
 const [query, setQuery] = useState('');
 const [project, setProject] = useState('all');
 const [statusFilter, setStatusFilter] = useState('all');
 const [persona, setPersona] = useState('all');
 const [relayUrl, setRelayUrl] = useState('');
 const [code, setCode] = useState('');
 const [notice, setNotice] = useState('');
 const [pairing, setPairing] = useState(false);
 const [preview, setPreview] = useState(false);
 const [pending, setPending] = useState<Record<string,string>>({});
 const [results, setResults] = useState<Record<string,string>>({});
 const [theme, setTheme] = useState<'dark'|'light'>('dark');
 const active = connections.find(c => c.id === selected);
 const data = preview ? fixture : active?.snapshot ?? null;
 const canDecide = preview ? false : Boolean(active?.online && active.client.canDecide());
 useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
 useEffect(() => { if (!active) { setSession(null); return; } active.client.watch(session?.sessionId ?? ''); return active.client.subscribe(onEvent); function onEvent(event: RelayEvent) {
   if (event.kind === 'snapshot') setConnections(cs => cs.map(c => c.id === active.id ? {...c,snapshot:event.value,online:true,name:event.value.instance.name} : c));
   if (event.kind === 'session') setSession(event.value);
   if (event.kind === 'offline') setConnections(cs => cs.map(c => c.id === active.id ? {...c,online:false} : c));
   if (event.kind === 'result') { setPending(p => { const next={...p}; delete next[event.approvalId]; return next; }); setResults(p=>({...p,[event.approvalId]:event.status})); }
   if (event.kind === 'error') setNotice(event.message);
 } }, [active?.id]);
 const sessions = data?.sessions ?? [];
 const projects = useMemo(()=>Array.from(new Set(sessions.flatMap(s=>s.project?[s.project]:[]))),[data]);
 const personas = useMemo(()=>Array.from(new Set(sessions.flatMap(s=>s.persona?[s.persona]:[]))),[data]);
 const filtered = sessions.filter(s => (s.title+' '+(s.project??'')+' '+(s.persona??'')).toLowerCase().includes(query.toLowerCase()) && (project==='all'||s.project===project) && (persona==='all'||s.persona===persona) && (statusFilter==='all'||(statusFilter==='active')===s.active));
 async function doPair() { try { setPairing(true); setNotice(''); const {client}=await pairRelay(relayUrl.trim(),code.trim()); const connection:Connection={id:'pending',name:'Connecting…',client,snapshot:null,online:true}; setConnections(cs=>[...cs,connection]); setSelected('pending'); setCode(''); } catch(e) { setNotice(e instanceof Error?e.message:'Pairing failed.'); } finally { setPairing(false); } }
 function enterPreview(){ setPreview(true); setSelected(''); setView('sessions'); setSession(previewSession); }
 function watchSession(id:string){ if(preview){setSession(previewSession);return;} active?.client.watch(id); setSession(null); setView('sessions'); }
 async function decide(a:Approval, choice:'approve'|'deny') { if(!active||!canDecide)return; try { const requestId=active.client.decide(a,choice); setPending(p=>({...p,[a.id]:choice+'|'+requestId})); setNotice('Decision sent. Waiting for Kalio to confirm.'); } catch(e){setNotice(e instanceof Error?e.message:'Decision was not sent.');} }
 return <main className="app-shell">
  <header className="topbar"><div className="brand"><span className="brand-mark">K</span><span>kalio</span><small>REMOTE</small></div><div className="header-actions"><span className={data?'connection-dot live':'connection-dot'} />{data?.instance.name ?? 'No instance connected'}<button className="icon-button" aria-label="Toggle theme" onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button></div></header>
  <div className="mobile-layout"><aside className="sidebar">
   <div className="section-label">INSTANCES <span>{connections.length+(preview?1:0)}</span></div>
   {connections.map(c=><button key={c.id} className={'instance '+(!preview&&selected===c.id?'selected':'')} onClick={()=>{setPreview(false);setSelected(c.id);setSession(null)}}><span className={c.online?'live-dot':'offline-dot'} />{c.name}<small>{c.online?'Online':'Offline'}</small></button>)}
   {preview&&<button className="instance selected" onClick={()=>setView('sessions')}><span className="preview-dot"/>Studio workstation<small>Preview</small></button>}
   <div className="pair-box"><div className="pair-heading"><Link2 size={15}/> Pair instance</div><input aria-label="Relay URL" placeholder="https://relay.example.com" value={relayUrl} onChange={e=>setRelayUrl(e.target.value)}/><input aria-label="One-use pairing code" placeholder="One-use code" value={code} onChange={e=>setCode(e.target.value)}/><button className="primary-button" disabled={pairing||!relayUrl||!code} onClick={doPair}>{pairing?'Pairing…':'Connect securely'}</button><small>Paste the one-use code from your Kalio host.</small></div>
   <button className="preview-link" onClick={enterPreview}><CircleHelp size={15}/> Open labeled preview</button>
  </aside><section className="content">
   {notice&&<div className="notice" role="status"><ShieldAlert size={16}/>{notice}<button aria-label="Dismiss" onClick={()=>setNotice('')}><X size={15}/></button></div>}
   {!data&&!preview?<div className="empty"><div className="empty-icon"><Link2/></div><h1>Connect to a Kalio host</h1><p>Pair with a relay to monitor sessions and review tool approvals.</p><p className="muted">Credentials stay in memory and clear when this app closes.</p></div>:<>
    <div className="page-heading"><div><span className="eyebrow">{preview?'LOCAL PREVIEW':data?.instance.name}</span><h1>{view==='approvals'?'Approvals':view==='graph'?'Execution graph':'Sessions'}</h1></div><nav className="tabs"><button className={view==='sessions'?'active':''} onClick={()=>setView('sessions')}><Activity size={16}/>Sessions</button><button className={view==='approvals'?'active':''} onClick={()=>setView('approvals')}><ShieldAlert size={16}/>Approvals{data?.approvals.length? <b>{data.approvals.length}</b>:null}</button></nav></div>
    {preview&&<div className="preview-banner"><span>PREVIEW DATA</span> Local fixture only. No network connection or approval action is available.</div>}
    {!preview&&active&&!canDecide&&<div className="stale-banner"><span className="offline-dot"/> Snapshot is stale or offline. Decisions are disabled until a fresh relay snapshot arrives.</div>}
    {view==='sessions'&&<div className="split"><div className="session-list"><div className="filter-row"><label className="search"><Search size={16}/><input value={query} placeholder="Search sessions" onChange={e=>setQuery(e.target.value)}/></label><select aria-label="Filter project" value={project} onChange={e=>setProject(e.target.value)}><option value="all">All projects</option>{projects.map(x=><option key={x}>{x}</option>)}</select><select aria-label="Filter status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All status</option><option value="active">Active</option><option value="ended">Ended</option></select><select aria-label="Filter persona" value={persona} onChange={e=>setPersona(e.target.value)}><option value="all">All personas</option>{personas.map(x=><option key={x}>{x}</option>)}</select></div>{filtered.map(s=><button key={s.id} className={'session-row '+(session?.sessionId===s.id?'chosen':'')} onClick={()=>watchSession(s.id)}><span className={s.active?'active-mark':'idle-mark'}/><span className="session-copy"><strong>{s.parentSessionId?'↳ ':''}{s.title}</strong><small>{s.project??'No project'} · {s.persona??'Default persona'}</small></span><span className="row-status">{s.active?'Running':'Ended'}</span></button>)}{filtered.length===0&&<div className="empty-list">No sessions match these filters.</div>}</div><SessionPanel session={session} onGraph={()=>setView('graph')}/></div>}
    {view==='approvals'&&<div className="approval-list">{(data?.approvals??[]).map(a=><ApprovalCard key={a.id} approval={a} disabled={!canDecide||Boolean(pending[a.id])} pending={pending[a.id]} result={results[a.id]} onDecide={choice=>decide(a,choice)}/>)}{!data?.approvals.length&&<div className="empty-list">No pending approvals.</div>}</div>}
    {view==='graph'&&<GraphPanel session={session}/>}
   </>}
  </section></div>
  <footer className="bottom-note"><span><ShieldAlert size={14}/> Read-only supervision</span><span>No chat commands · No automatic approval</span></footer>
 </main>;
}
function SessionPanel({session,onGraph}:{session:SessionSnapshot|null;onGraph:()=>void}) { return <section className="detail-panel"><div className="panel-title"><div><span className="eyebrow">SESSION VIEW</span><h2>{session?'Activity':'Choose a session'}</h2></div>{session&&<button className="subtle-button" onClick={onGraph}><GitBranch size={15}/> Graph</button>}</div>{!session?<div className="detail-empty">Select a session to inspect its messages and progress.</div>:<div className="messages">{session.messages.map(m=><article key={m.id} className={'message '+(m.role==='user'?'from-user':'')}><span className="message-role">{m.role==='user'?'YOU':'KALIO'}</span><p>{m.content}</p>{m.createdAt&&<time>{new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time>}</article>)}</div>}</section>; }
function ApprovalCard({approval,disabled,pending,result,onDecide}:{approval:Approval;disabled:boolean;pending?:string;result?:string;onDecide:(choice:'approve'|'deny')=>void}) { return <article className="approval-card"><div className="approval-head"><div><span className="eyebrow">TOOL APPROVAL</span><h2>{approval.toolName}</h2></div><span className="pending-pill">{result??(pending?'Awaiting host':'Pending')}</span></div><dl><div><dt>Session</dt><dd>{approval.sessionId}</dd></div><div><dt>Revision</dt><dd>{approval.revision}</dd></div><div><dt>Arguments SHA-256</dt><dd className="digest">{approval.argsSha256}</dd></div><div><dt>Requested</dt><dd>{approval.requestedAt?new Date(approval.requestedAt).toLocaleString():'Time unavailable'}</dd></div></dl><div className="args-box"><div className="args-label">FULL TOOL ARGUMENTS</div><pre>{JSON.stringify(approval.args,null,2)}</pre></div>{pending&&<p className="decision-wait">Decision sent. Waiting for the host result.</p>}{result&&<p className="decision-result"><Check size={15}/>{result}</p>}<div className="decision-actions"><button className="deny-button" disabled={disabled} onClick={()=>onDecide('deny')}><X size={16}/> Deny once</button><button className="approve-button" disabled={disabled} onClick={()=>onDecide('approve')}><Check size={16}/> Approve once</button></div>{disabled&&<small className="disabled-reason">Requires a fresh connection and snapshot.</small>}</article>; }
function GraphPanel({session}:{session:SessionSnapshot|null}) { return <div className="graph-panel"><div className="graph-heading"><Layers size={17}/><div><strong>Execution trace</strong><small>Read-only · list view</small></div><ChevronDown size={16}/></div>{!session||!session.graph.nodes.length?<div className="detail-empty">No execution graph is available for this session.</div>:<ol className="graph-list">{session.graph.nodes.map((n,i)=><li key={n.id}><span className={'node-dot '+(n.status==='running'?'running':'')}>{i+1}</span><div><strong>{n.label}</strong><small>{n.type}{n.status?' · '+n.status:''}</small></div></li>)}</ol>}</div>; }
