import { describe, expect, it } from 'vitest';
import { parseSession, parseSnapshot } from './protocol';

describe('host remote supervision DTO parsing', () => {
  it('parses numeric timestamps and IDs used by project/persona filters', () => {
    const snapshot=parseSnapshot({instance:{id:'i1',name:'Host'},sessions:[{id:'s1',title:'Session',updatedAt:1730000000000,active:true,projectId:'p1',personaId:'persona-a'}],approvals:[]});
    expect(snapshot?.sessions[0]).toMatchObject({id:'s1',project:'p1',projectId:'p1',persona:'persona-a',personaId:'persona-a',updatedAt:new Date(1730000000000).toISOString()});
  });
  it('retains messages for ordinary chat when graph is unavailable', () => {
    const parsed=parseSession({session:{id:'s1',title:'Chat',updatedAt:1730000000000,active:true},messages:[{id:'m1',sessionId:'s1',role:'user',content:'hello',createdAt:1730000001000}],graph:{available:false,reason:'no_architecture_run'}});
    expect(parsed?.sessionId).toBe('s1');
    expect(parsed?.messages[0].createdAt).toBe(new Date(1730000001000).toISOString());
    expect(parsed?.graph).toMatchObject({available:false,reason:'no_architecture_run',nodes:[]});
  });
  it('maps actual ArchitectureGraphProjection node and edge fields', () => {
    const parsed=parseSession({session:{id:'s1',title:'Run',updatedAt:10,active:true},messages:[],graph:{available:true,runId:'r1',projection:{runId:'r1',nodes:[{id:'n1',label:'Research',kind:'role',status:'running',sessionId:'child'}],edges:[{id:'e1',fromNodeId:'n1',toNodeId:'n2',label:'next'}]}}});
    expect(parsed?.graph.nodes[0]).toMatchObject({id:'n1',label:'Research',type:'role',status:'running'});
    expect(parsed?.graph.edges[0]).toMatchObject({id:'e1',source:'n1',target:'n2'});
  });
  it('rejects malformed approvals instead of dropping or weakening their arguments', () => {
    expect(parseSnapshot({instance:{id:'i1',name:'Host'},sessions:[],approvals:[{id:'a',sessionId:'s',toolName:'file.write',args:'not-an-object',requestedAt:10,revision:'r',argsSha256:'d'}]})).toBeNull();
    expect(parseSnapshot({instance:{id:'i1',name:'Host'},sessions:[],approvals:[{id:'a',sessionId:'s',toolName:'file.write',args:{path:'x'},requestedAt:10,revision:'r'}]})).toBeNull();
  });
});
