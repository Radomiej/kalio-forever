import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelayClient, type RelayEvent } from './RelayClient';
import type { Approval } from '../protocol';

class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: {data:string}) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: URL) { MockWebSocket.all.push(this); }
  send(value: string): void { this.sent.push(value); }
  close(): void { this.readyState=3; this.onclose?.(); }
  receive(value: unknown): void { this.onmessage?.({data:JSON.stringify(value)}); }
  open(): void { this.onopen?.(); }
  static all: MockWebSocket[]=[];
}
const sessionDto=(id:string)=>({session:{id,title:id,updatedAt:10,active:true},messages:[],graph:{available:false,reason:'no_architecture_run'}});
function snapshot(instanceId:string,sequence:number){return {v:1,type:'snapshot',instanceId,sequence,payload:{instance:{id:instanceId,name:instanceId},sessions:[],approvals:[]}};}
function client(id:string){return new RelayClient('https://relay.example.test',{v:1,instanceId:id,deviceId:'device-'+id,token:'secret-'+id});}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();MockWebSocket.all=[];});

function connectedClient() {
 vi.stubGlobal('WebSocket', MockWebSocket);
 const relay = client('one');
 const events: RelayEvent[] = [];
 relay.subscribe(event => events.push(event));
 relay.connect();
 const socket = MockWebSocket.all[0]!;
 socket.open();
 socket.receive({ v: 1, type: 'auth.accepted', instanceId: 'one' });
 socket.receive(snapshot('one', 10));
 return { relay, socket, events };
}

function lastRequest(socket: MockWebSocket): string {
 return JSON.parse(socket.sent.at(-1)!).requestId as string;
}

describe('RelayClient device protocol',()=>{
 it('surfaces only the current watch error and keeps its live updates correlated', () => {
  const { relay, socket, events } = connectedClient();
  relay.watch('A');
  const replaced = lastRequest(socket);
  relay.watch('B');
  const current = lastRequest(socket);
  const error = { v: 1, type: 'session.snapshot', instanceId: 'one', payload: { session: null, error: 'projection_failed' } };
  socket.receive({ ...error, requestId: replaced });
  socket.receive({ ...error, instanceId: 'foreign', requestId: current });
  socket.receive(error);
  expect(events.map(event => event.kind)).toEqual(['snapshot']);
  socket.receive(snapshot('one', 11));
  expect(lastRequest(socket)).toBe(current);
  socket.receive({ ...error, requestId: current });
  expect(events.at(-1)).toMatchObject({ kind: 'session-error', sessionId: 'B', message: expect.stringContaining('projection_failed') });
  socket.receive({ ...error, requestId: current, payload: sessionDto('B') });
  expect(events.at(-1)).toMatchObject({ kind: 'session', value: { sessionId: 'B' } });
  relay.watch('');
  socket.receive({ ...error, requestId: current });
  expect(events.at(-1)?.kind).toBe('session');
 });
 it.each(['relay_busy', 'watch_limit'])('retries a matching %s on the next fresh snapshot', error => {
  const { relay, socket, events } = connectedClient();
  relay.watch('A');
  const previous = lastRequest(socket);
  const response = { v: 1, type: 'session.snapshot', instanceId: 'one', payload: { session: null, error } };
  socket.receive({ ...response, requestId: 'foreign' });
  socket.receive(snapshot('one', 11));
  expect(lastRequest(socket)).toBe(previous);
  socket.receive({ ...response, requestId: previous });
  expect(events.at(-1)).toMatchObject({ kind: 'session-error', sessionId: 'A' });
  socket.receive(snapshot('one', 11));
  expect(lastRequest(socket)).toBe(previous);
  socket.receive(snapshot('one', 12));
  const current = lastRequest(socket);
  expect(current).not.toBe(previous);
  socket.receive({ ...response, requestId: previous, payload: sessionDto('A') });
  expect(events.at(-1)?.kind).toBe('snapshot');
  socket.receive({ ...response, requestId: current, payload: sessionDto('A') });
  expect(events.at(-1)?.kind).toBe('session');
 });
 it.each([false, true])('unwatches on deselection even after a transient rejection (%s)', rejected => {
  const { relay, socket } = connectedClient();
  relay.watch('A');
  if (rejected) {
   socket.receive({ v: 1, type: 'session.snapshot', instanceId: 'one', requestId: lastRequest(socket), payload: { session: null, error: 'relay_busy' } });
  }
  relay.watch('');
  expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ v: 1, type: 'session.unwatch', instanceId: 'one' });
  const sent = socket.sent.length;
  relay.watch('');
  socket.receive(snapshot('one', 11));
  expect(socket.sent).toHaveLength(sent);
 });
 it('resumes the selected watch only after fresh host hydration, ignoring old replies', () => {
  const { relay, socket, events } = connectedClient();
  relay.watch('A');
  const old = lastRequest(socket);
  const response = { v: 1, type: 'session.snapshot', instanceId: 'one', requestId: old, payload: sessionDto('A') };
  socket.receive({ v: 1, type: 'instance.offline', instanceId: 'one' });
  socket.receive(response);
  socket.receive(snapshot('one', 11));
  socket.receive({ v: 1, type: 'instance.online', instanceId: 'one' });
  socket.receive(response);
  expect(events.map(event => event.kind)).toEqual(['snapshot', 'offline', 'hydrating']);
  expect(lastRequest(socket)).toBe(old);
  socket.receive(snapshot('one', 1));
  const current = lastRequest(socket);
  expect(current).not.toBe(old);
  socket.receive(response);
  socket.receive({ ...response, requestId: current });
  expect(events.map(event => event.kind)).toEqual(['snapshot', 'offline', 'hydrating', 'snapshot', 'session']);
 });
 it('invalidates a watch across both socket close and replacement', () => {
  vi.useFakeTimers();
  const { relay, socket, events } = connectedClient();
  relay.watch('A');
  const old = lastRequest(socket);
  const response = { v: 1, type: 'session.snapshot', instanceId: 'one', requestId: old, payload: sessionDto('A') };
  socket.close();
  socket.receive(response);
  vi.advanceTimersByTime(1500);
  const next = MockWebSocket.all[1]!;
  next.open();
  next.receive({ v: 1, type: 'auth.accepted', instanceId: 'one' });
  next.receive(response);
  next.receive(snapshot('one', 1));
  const current = lastRequest(next);
  socket.receive({ ...response, requestId: current });
  next.receive(response);
  next.receive({ ...response, requestId: current });
  expect(events.map(event => event.kind)).toEqual(['snapshot', 'offline', 'snapshot', 'session']);
 });
 it('consumes only the matching approval rejection, including after host offline', () => {
  const { relay, socket, events } = connectedClient();
  const approval: Approval = { id: 'approval', sessionId: 'A', toolName: 'test', args: {}, revision: '1', argsSha256: 'hash' };
  const requestId = relay.decide(approval, 'deny');
  const rejection = { v: 1, type: 'approval.rejected', instanceId: 'one', requestId, reason: 'instance_offline' };
  socket.receive({ ...rejection, instanceId: 'foreign' });
  socket.receive({ ...rejection, requestId: 'foreign' });
  expect(events.map(event => event.kind)).toEqual(['snapshot']);
  socket.receive({ v: 1, type: 'instance.offline', instanceId: 'one' });
  socket.receive(rejection);
  socket.receive(rejection);
  socket.receive({ ...rejection, type: 'approval.result', payload: { approvalId: approval.id, status: 'settled' } });
  expect(events.map(event => event.kind)).toEqual(['snapshot', 'offline', 'result']);
  expect(events.at(-1)).toMatchObject({ requestId, approvalId: approval.id, status: 'rejected', reason: 'instance_offline' });
 });
 it('invalidates a replaced host’s pending decision and watch before a fresh snapshot', () => {
  const { relay, socket, events } = connectedClient();
  const approval: Approval = { id: 'approval', sessionId: 'A', toolName: 'test', args: {}, revision: '1', argsSha256: 'hash' };
  const requestId = relay.decide(approval, 'deny');
  relay.watch('A');
  const oldWatch = lastRequest(socket);
  socket.receive({ v: 1, type: 'instance.online', instanceId: 'one' });
  expect(relay.canDecide()).toBe(false);
  socket.receive({ v: 1, type: 'approval.rejected', instanceId: 'one', requestId, reason: 'instance_offline' });
  socket.receive({ v: 1, type: 'session.snapshot', instanceId: 'one', requestId: oldWatch, payload: sessionDto('A') });
  expect(events.map(event => event.kind)).toEqual(['snapshot', 'hydrating']);
  socket.receive(snapshot('one', 1));
  expect(lastRequest(socket)).not.toBe(oldWatch);
  expect(relay.canDecide()).toBe(true);
 });
 it('authenticates in the first frame and waits for auth.accepted before snapshots',()=>{
  vi.stubGlobal('WebSocket',MockWebSocket);const c=client('one');const events:unknown[]=[];c.subscribe(e=>events.push(e));c.connect();const ws=MockWebSocket.all[0]!;ws.open();
  expect(ws.url.pathname).toBe('/v1/device');expect(JSON.parse(ws.sent[0]!).type).toBe('auth');expect(JSON.parse(ws.sent[0]!).token).toBe('secret-one');
  ws.receive(snapshot('one',1));expect(events).toHaveLength(0);ws.receive({v:1,type:'auth.accepted',instanceId:'one'});ws.receive(snapshot('one',1));expect(events).toHaveLength(1);
 });
 it('rejects stale sequence and late session.watch replies after a newer request',()=>{
  vi.stubGlobal('WebSocket',MockWebSocket);const c=client('one');const sessions:string[]=[];let snapshots=0;c.subscribe(e=>{if(e.kind==='session')sessions.push(e.value.sessionId);if(e.kind==='snapshot')snapshots++;});c.connect();const ws=MockWebSocket.all[0]!;ws.open();ws.receive({v:1,type:'auth.accepted',instanceId:'one'});ws.receive(snapshot('one',3));
  c.watch('A');const reqA=JSON.parse(ws.sent.at(-1)!).requestId as string;c.watch('B');const reqB=JSON.parse(ws.sent.at(-1)!).requestId as string;
  ws.receive({v:1,type:'session.snapshot',instanceId:'one',requestId:reqA,payload:sessionDto('A')});expect(sessions).toEqual([]);
  ws.receive({v:1,type:'session.snapshot',instanceId:'one',requestId:reqB,payload:sessionDto('B')});expect(sessions).toEqual(['B']);
  ws.receive(snapshot('one',2));expect(snapshots).toBe(1);
 });
 it('keeps multiple client instances isolated',()=>{
  vi.stubGlobal('WebSocket',MockWebSocket);const a=client('a'),b=client('b');const seen:string[]=[];
  a.subscribe(e=>{if(e.kind==='snapshot')seen.push('a:'+e.value.instance.id)});b.subscribe(e=>{if(e.kind==='snapshot')seen.push('b:'+e.value.instance.id)});
  a.connect();b.connect();const [wa,wb]=MockWebSocket.all;wa!.open();wb!.open();wa!.receive({v:1,type:'auth.accepted',instanceId:'a'});wb!.receive({v:1,type:'auth.accepted',instanceId:'b'});wa!.receive(snapshot('a',1));wb!.receive(snapshot('b',1));wa!.receive(snapshot('b',2));expect(seen).toEqual(['a:a','b:b']);
 });
 it('refreshes the socket using saved credentials and ignores the replaced connection',()=>{
  vi.stubGlobal('WebSocket',MockWebSocket);
  const original=client('one');
  const saved=original.credentials();
  original.disconnect();
  const restored=new RelayClient(saved.relayUrl,saved.pair);
  const seen:string[]=[];
  restored.subscribe(event=>seen.push(event.kind));
  restored.connect();
  const old=MockWebSocket.all[0]!;
  restored.connect();
  const next=MockWebSocket.all[1]!;
  expect(old.readyState).toBe(3);
  old.receive({v:1,type:'auth.accepted',instanceId:'one'});
  old.receive(snapshot('one',2));
  next.open();
  expect(JSON.parse(next.sent[0]!)).toMatchObject({type:'auth',token:'secret-one'});
  next.receive({v:1,type:'auth.accepted',instanceId:'one'});
  next.receive(snapshot('one',1));
  expect(seen).toEqual(['snapshot']);
 });
});
