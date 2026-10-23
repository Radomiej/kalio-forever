import { describe, expect, it, vi } from 'vitest';
import { readPersistedGoalLaunchCalls } from './goal-launch-persisted-call';
import { detachHostReceiptArgs } from './host-receipt-json';

const parse = (json: string) => readPersistedGoalLaunchCalls(json, Buffer.from(json, 'utf8'));
describe('persisted goal launch calls (legacy serialization only)', () => {
  it('preserves null as empty calls independently of bytes and parses empty array', () => {
    expect(readPersistedGoalLaunchCalls(null, undefined)).toEqual([]);
    expect(parse('[]')).toEqual([]);
  });
  it('parses golden UTF-8 controls/astral text, exact call fields and legacy sorted detached args', () => {
    const json = '[{"id":" call ","name":"run_sub_agentflow","args":{"z":"Żółć 😀\\n\\u0000","a":{"z":0,"a":1}}}]';
    const calls = parse(json);
    expect(calls).toEqual([{ id: ' call ', name: 'run_sub_agentflow', args: { a: { a: 1, z: 0 }, z: 'Żółć 😀\n\u0000' } }]);
    expect(JSON.stringify(calls[0]?.args)).toBe('{"a":{"a":1,"z":0},"z":"Żółć 😀\\n\\u0000"}');
    expect(Object.isFrozen(calls[0])).toBe(true); expect(Object.isFrozen(calls[0]?.args)).toBe(true);
    expect(Object.getPrototypeOf(calls[0]?.args)).toBeNull();
  });
  it('does not impose tool-name filtering, uniqueness, or stricter negative-zero/surrogate rules', () => {
    const calls = parse('[{"id":"same","name":"other_tool","args":{"n":-0,"s":"\\ud800"}},{"id":"same","name":"run_sub_agentflow","args":{}}]');
    expect(calls.map(c => c.id)).toEqual(['same', 'same']);
    expect(calls[0]?.name).toBe('other_tool'); expect(Object.is(calls[0]?.args.n, -0)).toBe(true);
    expect(calls[0]?.args.s).toBe('\ud800');
    expect(JSON.stringify(calls[0]?.args)).toBe('{"n":0,"s":"\\ud800"}');
  });
  it('retains array order and integer-key JSON.stringify ordering in detached args', () => {
    const calls = parse('[{"id":"c","name":"n","args":{"z":[2,1],"10":"ten","2":"two","a":true}}]');
    expect(JSON.stringify(calls[0]?.args)).toBe('{"2":"two","10":"ten","a":true,"z":[2,1]}');
    expect(Object.isFrozen(calls[0]?.args.z)).toBe(true);
  });
  it.each(['{}', 'null', 'false', '[1]', '[null]', '[[]]', '[{}]',
    '[{"id":"c","name":"n","args":{},"extra":1}]', '[{"id":"","name":"n","args":{}}]',
    '[{"id":"c","name":" ","args":{}}]', '[{"id":"c","name":"n","args":null}]',
    '[{"id":"c","name":"n","args":[]}]', '[{"id":"c","name":"n","args":{"bad":1e999}}]',
    'PRIVATE'])('rejects corrupt stored JSON with a static error (%#)', json => {
    expect(() => parse(json)).toThrow(/^GOAL_LAUNCH_PERSISTED_CALL_INVALID$/);
  });
  it('checks exact raw UTF-8 equality rather than semantic JSON equality', () => {
    const json = '[{"id":"c","name":"n","args":{}}]';
    for (const bytes of [Buffer.from(json + ' '), Buffer.from('[]'), undefined, json]) {
      expect(() => readPersistedGoalLaunchCalls(json, bytes)).toThrow(/^GOAL_LAUNCH_PERSISTED_CALL_INVALID$/);
    }
    const malformed = Buffer.from([0xc0, 0xaf]);
    expect(() => readPersistedGoalLaunchCalls(malformed.toString('utf8'), malformed)).toThrow(/^GOAL_LAUNCH_PERSISTED_CALL_INVALID$/);
    expect(readPersistedGoalLaunchCalls(json, Uint8Array.from(Buffer.from(json)))).toHaveLength(1);
  });
  it('does not invoke getters or proxies passed in place of persisted text', () => {
    const getter = vi.fn(() => { throw new Error('PRIVATE'); });
    const text = Object.defineProperty({}, 'toString', { get: getter });
    const proxy = new Proxy({}, { get: getter, ownKeys: getter });
    for (const value of [text, proxy]) expect(() => readPersistedGoalLaunchCalls(value, Buffer.from('[]'))).toThrow(/^GOAL_LAUNCH_PERSISTED_CALL_INVALID$/);
    expect(getter).not.toHaveBeenCalled();
  });
  it('moved clone preserves legacy undefined, -0, lone surrogates and recursive freezing', () => {
    const input = { z: undefined, a: [undefined, -0, '\ud800'] }; const detached = detachHostReceiptArgs(input);
    expect(Object.hasOwn(detached, 'z')).toBe(true); expect(detached.z).toBeUndefined();
    expect(detached.a).toEqual([undefined, -0, '\ud800']);
    expect(JSON.stringify(detached)).toBe('{"a":[null,0,"\\ud800"]}');
    expect(Object.isFrozen(detached)).toBe(true); expect(Object.isFrozen(detached.a)).toBe(true);
    input.a.push('later'); expect(detached.a).toEqual([undefined, -0, '\ud800']);
  });
  it('moved clone still rejects getters/proxies/cycles without invoking hooks', () => {
    const getter = vi.fn(() => { throw new Error('PRIVATE'); });
    const accessor = Object.defineProperty({}, 'a', { enumerable: true, get: getter });
    const proxy = new Proxy({}, { ownKeys: getter, getPrototypeOf: getter });
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [accessor, proxy, cycle]) expect(() => detachHostReceiptArgs(value)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
