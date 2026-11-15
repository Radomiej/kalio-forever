import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelayClient } from './RelayClient';

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

describe('RelayClient device protocol',()=>{
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
});