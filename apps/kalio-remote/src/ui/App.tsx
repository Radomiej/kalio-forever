import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowLeft, CircleHelp, Link2, Menu, Moon, Pencil, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Sun, X } from 'lucide-react';
import type { Approval, SessionSnapshot, Snapshot } from '../protocol';
import { ApprovalCard, GraphPanel } from './RunDetails';
import { SessionPanel } from './SessionPanel';
import { pairRelay, RelayClient } from '../client/RelayClient';
import { canSaveHosts, readSavedHosts, saveHosts, type SavedHost } from '../client/deviceVault';

type View = 'sessions' | 'approvals' | 'graph';
type Connection = { id: string; name: string; alias?: string; client: RelayClient; snapshot: Snapshot | null; status: 'connecting'|'online'|'offline' };
const connectionLabels = { connecting: 'Łączenie…', online: 'Online', offline: 'Offline' } as const;
const fixture: Snapshot = { instance: { id: 'preview-instance', name: 'Studio workstation' }, sessions: [
 { id: 's1', title: 'Review authentication flow', active: true, project: 'kalio-web', persona: 'Architect', updatedAt: '2026-11-08T12:22:00Z' },
 { id: 's2', title: 'Mobile relay design', active: false, project: 'remote-client', persona: 'Developer', updatedAt: '2026-11-08T11:41:00Z' },
 { id: 's3', title: 'Inspect child task', active: true, project: 'kalio-api', persona: 'Researcher', parentSessionId: 's1', updatedAt: '2026-11-08T11:35:00Z' }
], approvals: [] };
const previewSession: SessionSnapshot = { sessionId: 's1', title: 'Przegląd uwierzytelniania', active: true, messages: [
 { id:'m1', role:'user', content:'Trace the refresh flow and identify where the session expires.', createdAt:'2026-11-08T12:20:00Z' },
 { id:'m2', role:'assistant', content:'I’m following the token refresh path and checking its expiration handling.', createdAt:'2026-11-08T12:21:00Z' },
 { id:'m3', role:'assistant', content:'The session module is open for read-only inspection.', createdAt:'2026-11-08T12:22:00Z' }
], graph:{ available:true, runId:'preview-run', nodes:[{id:'n1',type:'prompt',label:'User request',status:'complete'},{id:'n2',type:'agent',label:'Trace refresh flow',status:'running'},{id:'n3',type:'tool',label:'Read session.ts',status:'waiting'}], edges:[{id:'e1',source:'n1',target:'n2',type:'flow'},{id:'e2',source:'n2',target:'n3',type:'tool'}] } };

export function App() {
 const [connections, setConnections] = useState<Connection[]>([]);
 const subscriptions = useRef(new Map<string, () => void>());
 const clients = useRef(new Map<string, RelayClient>());
 const savedHosts = useRef(new Map<string, SavedHost>());
 const writeQueue = useRef(Promise.resolve());
 const latest = useRef({ selected: '', sessionId: '' });
 useEffect(() => () => { subscriptions.current.forEach(unsubscribe => unsubscribe()); subscriptions.current.clear(); clients.current.forEach(client => client.disconnect()); clients.current.clear(); }, []);
 const [selected, setSelected] = useState<string>('');
 const [view, setView] = useState<View>('sessions');
 const [sheet, setSheet] = useState<'instances'|'pair'|'filters'|'rename'|null>(null);
 const [aliasDraft, setAliasDraft] = useState('');
 const [selectedSessionId, setSelectedSessionId] = useState('');
 const [session, setSession] = useState<SessionSnapshot | null>(null);
 const [query, setQuery] = useState('');
 const [project, setProject] = useState('all');
 const [statusFilter, setStatusFilter] = useState('all');
 const [persona, setPersona] = useState('all');
 const [relayUrl, setRelayUrl] = useState('');
 const [code, setCode] = useState('');
 const [notice, setNotice] = useState('');
 const [pairing, setPairing] = useState(false);
 const [pairError, setPairError] = useState('');
 const [restoring, setRestoring] = useState(canSaveHosts);
 const [preview, setPreview] = useState(false);
 const [pending, setOczekuje] = useState<Record<string,string>>({});
 const [results, setResults] = useState<Record<string,string>>({});
 const [theme, setTheme] = useState<'dark'|'light'>('dark');
 const persistHosts = useCallback(() => {
  const records = [...savedHosts.current.values()];
  writeQueue.current = writeQueue.current.then(() => saveHosts(records)).catch(() => {
   setNotice('Nie udało się zapisać parowania na tym urządzeniu.');
  });
 }, []);
 const active = connections.find(c => c.id === selected);
 latest.current.selected = selected;
 const data = preview ? fixture : active?.snapshot ?? null;
 const [approvalSnapshotFresh, setApprovalSnapshotFresh] = useState(false);
 useEffect(() => {
  const refresh = () => setApprovalSnapshotFresh(active?.status === 'online' && active.client.canDecide());
  refresh();
  if (!active?.snapshot?.approvals.length || active.status !== 'online') return;
  const timer = setInterval(refresh, 1000);
  return () => clearInterval(timer);
 }, [active]);
 const canDecide = !preview && active?.status === 'online' && approvalSnapshotFresh && active.client.canDecide();
 useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
 const sessions = data?.sessions ?? [];
 const projects = useMemo(()=>Array.from(new Set(sessions.flatMap(s=>s.project?[s.project]:[]))),[data]);
 const personas = useMemo(()=>Array.from(new Set(sessions.flatMap(s=>s.persona?[s.persona]:[]))),[data]);
 const filtered = sessions.filter(s => (s.title+' '+(s.project??'')+' '+(s.persona??'')).toLowerCase().includes(query.toLowerCase()) && (project==='all'||s.project===project) && (persona==='all'||s.persona===persona) && (statusFilter==='all'||(statusFilter==='active')===s.active));

 const registerHost = useCallback((client: RelayClient, saved?: SavedHost) => {
  const id = client.connectionKey;
  subscriptions.current.get(id)?.();
  clients.current.get(id)?.disconnect();
  const connection: Connection = { id, name: saved?.name ?? client.instanceId, alias: saved?.alias, client, snapshot: null, status: 'connecting' };
  subscriptions.current.set(id, client.subscribe(event => {
   if (event.kind === 'snapshot') {
    const name = event.value.instance.name;
    setConnections(items => items.map(item => item.id === id ? { ...item, snapshot: event.value, status: 'online', name } : item));
    const stored = savedHosts.current.get(id);
    if (stored && stored.name !== name) {
     savedHosts.current.set(id, { ...stored, name });
     persistHosts();
    }
   }
   if (event.kind === 'offline') {
    setConnections(items => items.map(item => item.id === id ? { ...item, status: 'offline' } : item));
    setOczekuje(items => Object.fromEntries(Object.entries(items).filter(([key]) => !key.startsWith(id+'|'))));
   }
   if (event.kind === 'session' && latest.current.selected === id && event.value.sessionId === latest.current.sessionId) setSession(event.value);
   if (event.kind === 'result') {
    const key = id+'|'+event.approvalId;
    setOczekuje(items => { const next = { ...items }; delete next[key]; return next; });
    setResults(items => ({ ...items, [key]: event.status === 'settled' ? 'Rozstrzygnięto' : event.status === 'stale' ? 'Decyzja nieaktualna' : 'Decyzja odrzucona' }));
   }
   if (event.kind === 'error') setNotice(event.message);
  }));
  clients.current.set(id, client);
  setConnections(items => [...items.filter(item => item.id !== id), connection]);
  client.connect();
  return id;
 }, [persistHosts]);
 useEffect(() => {
  let cancelled = false;
  void readSavedHosts().then(hosts => {
   if (cancelled) return;
   const keys = hosts.map(host => {
    const client = new RelayClient(host.relayUrl, { ...host.pair });
    savedHosts.current.set(client.connectionKey, host);
    return registerHost(client, host);
   });
   if (keys[0]) setSelected(keys[0]);
  }).catch(() => {
   if (!cancelled) setNotice('Nie udało się odczytać zapisanego parowania. Połącz instancję ponownie.');
  }).finally(() => { if (!cancelled) setRestoring(false); });
  return () => { cancelled = true; };
 }, [registerHost]);
 async function doPair() {
  try {
   setPairing(true); setPairError('');
   const client = await pairRelay(relayUrl.trim(), code.trim());
   const previous = savedHosts.current.get(client.connectionKey);
   if (!previous && savedHosts.current.size >= 64) throw new Error('Osiągnięto limit 64 instancji.');
   const saved = { ...client.credentials(), name: previous?.name, alias: previous?.alias };
   savedHosts.current.set(client.connectionKey, saved);
   persistHosts();
   selectInstance(registerHost(client, saved));
   setCode('');
  } catch (error) {
   setPairError(error instanceof Error ? error.message : 'Nie udało się połączyć.');
  } finally {
   setPairing(false);
  }
 }
 function saveAlias() {
  if (!active) return;
  const alias = aliasDraft.trim() || undefined;
  const stored = savedHosts.current.get(active.id);
  if (stored) {
   savedHosts.current.set(active.id, { ...stored, alias });
   persistHosts();
  }
  setConnections(items => items.map(item => item.id === active.id ? { ...item, alias } : item));
  setSheet(null);
 }
 function refreshHosts() {
  setConnections(items => items.map(item => ({ ...item, status: 'connecting' })));
  setOczekuje({});
  clients.current.forEach(client => client.connect());
 }
 function resetSession() {
  latest.current.sessionId = '';
  setSelectedSessionId('');
  setSession(null);
  setView('sessions');
 }
 function selectInstance(id: string) {
  setPreview(false);
  setSelected(id);
  latest.current.selected = id;
  resetSession();
  setProject('all'); setPersona('all'); setStatusFilter('all'); setQuery('');
  setSheet(null);
 }
 function enterPreview() {
  selectInstance('');
  setPreview(true);
 }
 function watchSession(id: string) {
  setSelectedSessionId(id);
  setView('sessions');
  if (preview) {
   const previewItem = fixture.sessions.find(item => item.id === id);
   setSession(id === previewSession.sessionId ? previewSession : previewItem
    ? { sessionId: id, title: previewItem.title, active: previewItem.active, messages: [],
      graph: { available: false, reason: 'no_architecture_run', nodes: [], edges: [] } } : null);
   return;
  }
  if (!active) return;
  latest.current = { selected: active.id, sessionId: id };
  setSession(null);
  active.client.watch(id);
 }
 async function decide(a:Approval, choice:'approve'|'deny') { if(!active||!canDecide)return; try { const requestId=active.client.decide(a,choice); setOczekuje(p=>({...p,[active.id+'|'+a.id]:requestId})); setNotice('Wysłano decyzję. Oczekiwanie na potwierdzenie Kalio.'); } catch(e){setNotice(e instanceof Error?e.message:'Nie udało się wysłać decyzji.');} }
 const activeCount = sessions.filter(item => item.active).length;
 const approvals = canDecide ? (data?.approvals ?? []).filter(a => results[active.id+'|'+a.id] !== 'Rozstrzygnięto') : [];
 const approvalCount = approvals.length;
 const connectionLabel = preview ? 'Demo' : active ? connectionLabels[active.status] : restoring ? 'Wczytywanie…' : 'Niepołączono';
 return <main className="app-shell">
  <header className="topbar">
   <div className="brand"><span className="brand-mark">K</span><div><strong>Kalio Remote</strong><small>{preview ? 'Dane demonstracyjne' : active?.alias ?? active?.name ?? 'Podgląd instancji'}</small></div></div>
   <div className="header-actions">
    <span className="connection-status"><span className={preview ? 'preview-dot' : active?.status === 'online' ? 'live-dot' : 'offline-dot'} />{connectionLabel}</span>
    <button className="icon-button" aria-label="Menu Remote" aria-haspopup="dialog" onClick={()=>setSheet('instances')}><Menu size={22}/></button>
   </div>
  </header>
  <section className="content" aria-label="Aktywność Kalio">
   {notice&&<div className="notice" role="status"><ShieldAlert size={16}/>{notice}<button aria-label="Zamknij komunikat" onClick={()=>setNotice('')}><X size={15}/></button></div>}
   {preview&&<div className="preview-banner"><span>DEMO</span> Przykładowe dane bez połączenia z Kalio.</div>}
   {!preview&&active?.snapshot&&!canDecide&&<div className="stale-banner"><span className="offline-dot"/> Ostatni zapisany stan. Zgody są chwilowo niedostępne.</div>}
   {(!data&&!preview)?<div className="empty">
    <div className="empty-icon"><Link2/></div><h1>{restoring ? 'Wczytywanie instancji' : active?.status === 'offline' ? 'Instancja niedostępna' : active ? 'Łączenie z Kalio' : 'Połącz Kalio'}</h1>
    {!restoring&&<p>{active ? 'Czekam na aktualny stan instancji.' : 'Zobacz aktywność i oczekujące zgody z komputera.'}</p>}
    {!active&&!restoring&&<button className="primary-button" onClick={()=>{setPairError('');setSheet('pair')}}>Połącz instancję</button>}
    {active?.status === 'offline'&&<button className="primary-button" onClick={refreshHosts}>Odśwież połączenie</button>}
   </div>:<>
    {view==='sessions'&&<>
     <div className="page-heading session-heading">
      <div><h1>Sesje</h1><p>{activeCount ? 'W toku: '+activeCount : 'Brak aktywnych sesji'}</p></div>
      <button className="icon-button filter-button" aria-label="Filtry sesji" aria-haspopup="dialog" onClick={()=>setSheet('filters')}><SlidersHorizontal size={20}/></button>
     </div>
     <div className={'split'+(selectedSessionId?' has-session':'')}>
      <div className="session-list">
       {filtered.map(s=><button key={s.id} className={'session-row '+(selectedSessionId===s.id?'chosen':'')} onClick={()=>watchSession(s.id)}><span className={s.active?'active-mark':'idle-mark'}/><span className="session-copy"><strong>{s.parentSessionId?'↳ ':''}{s.title}</strong><small>{s.project??'Bez projektu'} · {s.persona??'Domyślna persona'}</small></span><span className="row-status">{s.active?'W toku':'Zakończona'}</span></button>)}
       {filtered.length===0&&<div className="empty-list">{sessions.length?'Brak wyników dla wybranych filtrów.':'Nie ma jeszcze sesji.'}</div>}
      </div>
      {selectedSessionId&&<div className="session-detail"><button className="subtle-button back-button" onClick={resetSession}><ArrowLeft size={16}/> Wróć do sesji</button><SessionPanel session={session} onGraph={()=>setView('graph')}/></div>}
     </div>
    </>}
    {view==='approvals'&&<><div className="page-heading"><div><h1>Zgody</h1><p>{approvalCount ? 'Oczekujące: '+approvalCount : 'Nic nie czeka na Twoją decyzję'}</p></div></div><div className="approval-list">{approvals.map(a=><ApprovalCard key={a.id} approval={a} disabled={!canDecide||a.decisionAvailable!==true||Boolean(pending[active?.id+'|'+a.id])} pending={pending[active?.id+'|'+a.id]} result={results[active?.id+'|'+a.id]} onDecide={choice=>decide(a,choice)}/>)}</div></>}
    {view==='graph'&&<><button className="subtle-button back-button" onClick={()=>setView('sessions')}><ArrowLeft size={16}/> Wróć do rozmowy</button><GraphPanel session={session}/></>}
   </>}
  </section>
  <nav className="tabs bottom-tabs" aria-label="Widoki Remote">
   <button className={view==='sessions'||view==='graph'?'active':''} aria-current={view==='sessions'||view==='graph'?'page':undefined} onClick={resetSession}><Activity size={18}/>Sesje</button>
   <button className={view==='approvals'?'active':''} aria-current={view==='approvals'?'page':undefined} onClick={()=>setView('approvals')} disabled={!data}><ShieldAlert size={18}/>Zgody{approvalCount>0&&<b>{approvalCount}</b>}</button>
  </nav>
  {sheet==='instances'&&<RemoteSheet title="Menu Remote" onClose={()=>setSheet(null)}>
   {connections.length>0&&<div className="instance-menu"><h3>Instancje</h3>{connections.map(c=><button key={c.id} className={'instance '+(!preview&&selected===c.id?'selected':'')} aria-pressed={!preview&&selected===c.id} onClick={()=>selectInstance(c.id)}><span className={c.status==='online'?'live-dot':'offline-dot'}/>{c.alias ?? c.name}<small>{connectionLabels[c.status]}</small></button>)}</div>}
   {connections.length>0&&<button className="menu-action" onClick={()=>{refreshHosts();setSheet(null)}}><RefreshCw size={18}/> Odśwież połączenia</button>}
   {active&&!preview&&<button className="menu-action" onClick={()=>{setAliasDraft(active.alias??'');setSheet('rename')}}><Pencil size={18}/> Zmień nazwę instancji</button>}
   <button className="menu-action" disabled={restoring} onClick={()=>{setPairError('');setSheet('pair')}}><Link2 size={18}/> Połącz instancję</button>
   <button className="menu-action" onClick={enterPreview}><CircleHelp size={18}/> Podgląd demo</button>
   <button className="menu-action" onClick={()=>{setTheme(theme==='dark'?'light':'dark');setSheet(null)}}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>} {theme==='dark'?'Jasny motyw':'Ciemny motyw'}</button>
  </RemoteSheet>}
  {sheet==='rename'&&<RemoteSheet title="Zmień nazwę instancji" onClose={()=>setSheet(null)}>
   <form className="pair-form" onSubmit={event=>{event.preventDefault();saveAlias()}}>
    <label>Nazwa w tej aplikacji<input maxLength={80} value={aliasDraft} placeholder={active?.name} onChange={event=>setAliasDraft(event.target.value)}/></label>
    <button className="primary-button" type="submit">Zapisz nazwę</button>
   </form>
  </RemoteSheet>}
  {sheet==='pair'&&<RemoteSheet title="Połącz instancję" onClose={()=>setSheet(null)}>
   <form className="pair-form" onSubmit={event=>{event.preventDefault();void doPair()}}>
    <label>Adres Relay<input type="url" autoComplete="off" placeholder="https://kalio-remote.nekko.software" value={relayUrl} onChange={event=>setRelayUrl(event.target.value)}/></label>
    <label>Kod jednorazowy<input autoComplete="off" autoCapitalize="none" spellCheck={false} value={code} onChange={event=>setCode(event.target.value)}/></label>
    {pairError&&<p className="form-error" role="alert">{pairError}</p>}
    <button className="primary-button" type="submit" disabled={pairing||!relayUrl.trim()||!code.trim()}>{pairing?'Łączenie…':'Połącz'}</button>
   </form>
  </RemoteSheet>}
  {sheet==='filters'&&<RemoteSheet title="Filtry sesji" onClose={()=>setSheet(null)}>
   <div className="pair-form">
    <label className="search"><Search size={16}/><input aria-label="Szukaj sesji" value={query} placeholder="Szukaj sesji" onChange={e=>setQuery(e.target.value)}/></label>
    <label>Projekt<select value={project} onChange={e=>setProject(e.target.value)}><option value="all">Wszystkie projekty</option>{projects.map(x=><option key={x}>{x}</option>)}</select></label>
    <label>Stan<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">Każdy stan</option><option value="active">Aktywna</option><option value="ended">Zakończona</option></select></label>
    <label>Persona<select value={persona} onChange={e=>setPersona(e.target.value)}><option value="all">Wszystkie persony</option>{personas.map(x=><option key={x}>{x}</option>)}</select></label>
    <button className="primary-button" onClick={()=>setSheet(null)}>Pokaż wyniki</button>
   </div>
  </RemoteSheet>}
 </main>;
}
function RemoteSheet({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
 const dialog = useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current; if(element&&!element.open)element.showModal();},[]);
 return <dialog ref={dialog} className="remote-sheet" aria-label={title} onCancel={event=>{event.preventDefault();onClose()}}>
  <div className="sheet-heading"><h2>{title}</h2><button className="icon-button" aria-label="Zamknij" onClick={onClose}><X size={20}/></button></div>
  {children}
 </dialog>;
}
