import { expect, it, vi } from 'vitest';
import { isProtectedGoalRequest } from './goal-launch-request-family';

const row = (marker: unknown, name = 'run_sub_agentflow') => ({
  continuation: { hostConfirmationRequirement: marker }, payload: { toolName: name },
});
it.each([null, [], 'bad', 0, undefined, { toolName: 'wrong' }])('protects own malformed marker plus goal payload %j', marker => {
  expect(isProtectedGoalRequest(row(marker))).toBe(true);
});
it.each([{ goalLaunch: null }, { goalLaunch: undefined }, { toolName: 'run_sub_agentflow' }])('protects marker despite payload drift %j', marker => {
  expect(isProtectedGoalRequest(row(marker, 'terminal_spawn'))).toBe(true);
});
it('preserves terminal and unmarked legacy without inferring authority from names', () => {
  expect(isProtectedGoalRequest(row({ kind:'human_only',toolName:'terminal_spawn' }, 'terminal_spawn'))).toBe(false);
  expect(isProtectedGoalRequest({ payload:{toolName:'run_sub_agentflow'},continuation:{} })).toBe(false);
  expect(isProtectedGoalRequest({ continuation:Object.create({hostConfirmationRequirement:{goalLaunch:{}}}),payload:{toolName:'run_sub_agentflow'} })).toBe(false);
  expect(isProtectedGoalRequest(null)).toBe(false);
});
it('fails closed on relevant accessor paths without invoking getters', () => {
  const get = vi.fn(() => { throw new Error('SECRET'); });
  const payloadAccessor = Object.defineProperty({ continuation:{hostConfirmationRequirement:{}} }, 'payload', { get });
  for (const hostile of [
    Object.defineProperty({}, 'continuation', { get }),
    { continuation:Object.defineProperty({}, 'hostConfirmationRequirement', { get }) },
    payloadAccessor,
    { continuation:{hostConfirmationRequirement:{}}, payload:Object.defineProperty({}, 'toolName', { get }) },
    row(Object.defineProperty({}, 'toolName', { get }), 'terminal_spawn'),
    row(Object.defineProperty({}, 'goalLaunch', { get }), 'terminal_spawn'),
  ]) {
    expect(isProtectedGoalRequest(hostile)).toBe(true);
  }
  expect(get).not.toHaveBeenCalled();
});
it('protects relevant proxies without invoking reflection traps', () => {
  const trap = vi.fn(() => { throw new Error('SECRET'); });
  const proxy = new Proxy({}, { get:trap,getOwnPropertyDescriptor:trap,ownKeys:trap,getPrototypeOf:trap });
  for (const hostile of [proxy, {continuation:proxy}, row(proxy, 'terminal_spawn'),
    {continuation:{hostConfirmationRequirement:{}},payload:proxy}]) expect(isProtectedGoalRequest(hostile)).toBe(true);
  expect(trap).not.toHaveBeenCalled();
});
