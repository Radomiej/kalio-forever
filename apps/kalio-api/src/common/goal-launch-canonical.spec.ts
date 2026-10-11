import { describe, expect, it, vi } from 'vitest';
import { canonicalGoalLaunchJson, hashGoalLaunchJson } from './goal-launch-canonical';

const golden: { name: string; input: unknown; json: string; sha256: string }[] = [
  { name: 'null', input: null, json: 'null', sha256: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b' },
  { name: 'empty object', input: {}, json: '{}', sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a' },
  { name: 'empty array', input: [], json: '[]', sha256: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' },
  { name: 'nested sorted objects', input: { b: [true, null, 'x'], a: { z: 1, b: 2 } },
    json: '{"a":{"b":2,"z":1},"b":[true,null,"x"]}', sha256: 'f5d918fb133c629f2289f3e58ffaf61c9e63e153327105e68c5b1f58b33905f8' },
  { name: 'integer keys use JSON.stringify ordering after ordinal insertion', input: { a: { z: 0, a: 1 }, 10: 'ten', 2: 'two' },
    json: '{"2":"two","10":"ten","a":{"a":1,"z":0}}', sha256: '0cb072cf72e5ef4d6cf1cf1ed5c58eeb76cb29b9d10051a59e8fdaa189f4f58c' },
  { name: 'astral and escaped controls', input: ['😀', '\u0000\n\t"\\', {}, []],
    json: '["😀","\\u0000\\n\\t\\"\\\\",{},[]]', sha256: '58c144b4cdcf54b5f8843a9b312fe46cb0982002f57d6e978434b7d21e3ead99' },
];
describe('strict goal-launch canonical JSON (not a legacy hash replacement)', () => {
  it.each(golden)('golden bytes and SHA: $name', ({ input, json, sha256 }) => {
    expect(canonicalGoalLaunchJson(input)).toBe(json);
    expect(hashGoalLaunchJson(input)).toBe(sha256);
  });
  it('uses ordinal UTF-16 ordering, not locale or Unicode code-point sorting', () => {
    expect(canonicalGoalLaunchJson({ '\ue000': 1, '\u{10000}': 2, Z: 3, a: 4 })).toBe('{"Z":3,"a":4,"𐀀":2,"":1}');
  });
  it('preserves array order and finite number/string/bool values', () => {
    expect(canonicalGoalLaunchJson([false, true, 0, -1, 1.25, 1e30, ''])).toBe('[false,true,0,-1,1.25,1e+30,""]');
    expect(hashGoalLaunchJson([1, 2])).not.toBe(hashGoalLaunchJson([2, 1]));
  });
  it('accepts null prototypes and repeated noncyclic references without mutating inputs', () => {
    const leaf = Object.assign(Object.create(null), { z: 'last', a: 'first' });
    const input = { b: leaf, a: leaf }; const before = Reflect.ownKeys(input);
    expect(canonicalGoalLaunchJson(input)).toBe('{"a":{"a":"first","z":"last"},"b":{"a":"first","z":"last"}}');
    expect(Reflect.ownKeys(input)).toEqual(before); expect(Object.getPrototypeOf(leaf)).toBeNull();
  });
  it('treats __proto__ as ordinary data and keeps deterministic nested insertion-order independence', () => {
    const input = JSON.parse('{"z":0,"__proto__":{"b":2,"a":1}}');
    expect(canonicalGoalLaunchJson(input)).toBe('{"__proto__":{"a":1,"b":2},"z":0}');
    expect(hashGoalLaunchJson({ b: { z: 0, a: 1 }, a: [] })).toBe(hashGoalLaunchJson({ a: [], b: { a: 1, z: 0 } }));
  });
  it.each([undefined, () => 'PRIVATE', 1n, Symbol('PRIVATE'), NaN, Infinity, -Infinity, -0,
    new Date(), new Map(), new Set(), new Number(1), Object.create({ inherited: 1 }),
    '\ud800', '\udfff', 'ok\ud800x', { '\ud800': 1 }, { value: '\udfff' },
    { nested: [undefined] }, { nested: { bad: -0 } }])('rejects unsupported values with only a static error (%#)', value => {
    for (const fn of [canonicalGoalLaunchJson, hashGoalLaunchJson]) expect(() => fn(value)).toThrow(/^GOAL_LAUNCH_JSON_INVALID$/);
  });
  it('rejects cycles but does not read accessors or call custom toJSON', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const array: unknown[] = []; array.push(array);
    const getter = vi.fn(() => { throw new Error('PRIVATE'); });
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
    const toJSON = vi.fn(() => { throw new Error('PRIVATE'); });
    for (const value of [cycle, array, accessor, { toJSON }, [accessor], Object.assign([], { toJSON })]) {
      expect(() => canonicalGoalLaunchJson(value)).toThrow(/^GOAL_LAUNCH_JSON_INVALID$/);
    }
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it('rejects proxy objects/arrays and revoked proxies before any traps', () => {
    const trap = vi.fn(() => { throw new Error('PRIVATE'); });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    for (const value of [new Proxy({}, { getPrototypeOf: trap, ownKeys: trap, get: trap }),
      new Proxy([], { getPrototypeOf: trap, ownKeys: trap, get: trap }), revoked.proxy]) {
      expect(() => hashGoalLaunchJson(value)).toThrow(/^GOAL_LAUNCH_JSON_INVALID$/);
    }
    expect(trap).not.toHaveBeenCalled();
  });
  it('rejects symbols, nonenumerable keys, sparse arrays and extra array keys', () => {
    const symbol = { [Symbol('PRIVATE')]: 1 };
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
    const extra = Object.assign([1], { extra: 2 });
    const hiddenArray = Object.defineProperty([1], '0', { enumerable: false });
    const symbolicArray = Object.assign([1], { [Symbol('PRIVATE')]: 2 });
    const getter = vi.fn(() => 'PRIVATE');
    const arrayGetter = Object.defineProperty([1], '0', { enumerable: true, get: getter });
    const customArray = Object.setPrototypeOf([1], Object.create(Array.prototype));
    for (const value of [symbol, hidden, new Array(1), extra, hiddenArray, symbolicArray, arrayGetter, customArray]) {
      expect(() => canonicalGoalLaunchJson(value)).toThrow(/^GOAL_LAUNCH_JSON_INVALID$/);
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects setter-only/nonenumerable toJSON descriptors without invoking hooks', () => {
    const hook = vi.fn(() => { throw new Error('PRIVATE'); });
    const setter = Object.defineProperty({}, 'value', { enumerable: true, set: hook });
    const hidden = Object.defineProperty({}, 'toJSON', { value: hook });
    const accessor = Object.defineProperty({}, 'toJSON', { enumerable: true, get: hook });
    for (const value of [setter, hidden, accessor]) expect(() => hashGoalLaunchJson(value)).toThrow(/^GOAL_LAUNCH_JSON_INVALID$/);
    expect(hook).not.toHaveBeenCalled();
  });
});
