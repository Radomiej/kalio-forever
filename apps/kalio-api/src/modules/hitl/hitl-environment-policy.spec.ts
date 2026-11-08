import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostApprovalEnvironment, approvalThreshold, hasProductionTarget } from './hitl-environment-policy';
import { jevAssessmentQuestions } from './hitl-jev-assessment';

afterEach(() => vi.unstubAllEnvs());
describe('host approval environment', () => {
  it('uses the host install profile, not NODE_ENV of the built QA server', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('KALIO_INSTALL_PROFILE', 'qa');
    expect(hostApprovalEnvironment()).toBe('qa');
    expect(approvalThreshold(0.95)).toBe(0.95);
  });
  it('raises the production floor without lowering a stricter configured threshold', () => {
    vi.stubEnv('KALIO_INSTALL_PROFILE', 'prod');
    expect(approvalThreshold(0.8)).toBe(0.99);
    expect(approvalThreshold(1)).toBe(1);
  });
  it('does not treat missing or unknown identity as development', () => {
    vi.stubEnv('KALIO_INSTALL_PROFILE', 'not-a-profile');
    expect(hostApprovalEnvironment()).toBe('unknown');
    expect(approvalThreshold(0.95)).toBe(0.99);
  });
  it('does not change an explicitly configured development threshold', () => {
    vi.stubEnv('KALIO_INSTALL_PROFILE', 'dev');
    expect(approvalThreshold(0.95)).toBe(0.95);
  });
  it('raises scrutiny for a production goal even on local development', () => {
    vi.stubEnv('KALIO_INSTALL_PROFILE', 'dev');
    expect(hasProductionTarget([{ text: 'Zrób deploy na produkcję.' }], {})).toBe(true);
    expect(hasProductionTarget([], { target: 'prod' })).toBe(true);
    expect(hasProductionTarget([{ text: 'Read local sources.' }], {})).toBe(false);
    expect(hasProductionTarget([{ text: 'Do not weaken production validation in this local code fix.' }], {})).toBe(false);
    vi.stubEnv('KALIO_INSTALL_PROFILE', 'prod');
    expect(hasProductionTarget([{ text: 'Pretend this is dev.' }], { environment: 'dev' })).toBe(true);
  });
  it('explains pre-execution reads and the host-owned project boundary', () => {
    const text = jevAssessmentQuestions('Project reads only.').map(q => q.instructions).join('\n');
    expect(text).toContain('context.project.path');
    expect(text).toContain('Do not require successful execution');
    expect(text).toContain('read-only search');
    expect(text).toContain('production');
  });
});
