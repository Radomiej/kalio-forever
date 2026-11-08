import { describe, expect, it } from 'vitest';
import { classifyJevAssessment, type ContextualJevEvaluation } from './hitl-jev-assessment';

const evaluation = (): ContextualJevEvaluation => ({
  assessment: { checks: { goal_alignment: 0.99, in_scope: 0.99, destructive_effect: 0.01, unauthorized_export: 0.01, evidence_sufficient: 0.99 }, contextFingerprint: 'a'.repeat(64) },
  model: 'jev-test', validateContext: () => true,
});

describe('classifyJevAssessment', () => {
  it('uses the editable production minimum for a production target', () => {
    const result = evaluation(); result.productionTarget = true;
    result.assessment.checks.goal_alignment = 0.94;
    expect(classifyJevAssessment(result, 0.8).status).toBe('manual');
    result.assessment.checks.goal_alignment = 0.95;
    expect(classifyJevAssessment(result, 0.8).status).toBe('approved');
    expect(classifyJevAssessment(result, 0.8).reason).toContain('productionTarget=true');
    result.productionThreshold = .97;
    expect(classifyJevAssessment(result, 0.8).status).toBe('manual');
  });
  it.each(['destructive_effect', 'unauthorized_export'] as const)('approves the exact .80/.20 boundary on %s', (id) => {
    const result = evaluation();
    result.assessment.checks[id] = 0.2;
    expect(classifyJevAssessment(result, 0.8).status).toBe('approved');
    result.assessment.checks[id] = 0.2000000000000002;
    expect(classifyJevAssessment(result, 0.8).status).toBe('manual');
  });

  it.each(['goal_alignment', 'in_scope'] as const)('rejects the exact .80/.20 complement boundary on %s', (id) => {
    const result = evaluation();
    result.assessment.checks[id] = 0.2;
    expect(classifyJevAssessment(result, 0.8).status).toBe('rejected');
    result.assessment.checks[id] = 0.2000000000000002;
    expect(classifyJevAssessment(result, 0.8).status).toBe('manual');
  });

  it('does not name an unspecified generic model as an approver', () => {
    const result = evaluation();
    Reflect.deleteProperty(result, 'model');
    expect(classifyJevAssessment(result, 0.95).status).toBe('manual');
  });

  it('requires every positive and negative axis, without averaging', () => {
    const result = evaluation();
    expect(classifyJevAssessment(result, 0.95).status).toBe('approved');
    result.assessment.checks.in_scope = 0.94;
    expect(classifyJevAssessment(result, 0.95).status).toBe('manual');
  });

  it.each(['destructive_effect', 'unauthorized_export'] as const)('applies negative polarity to %s', (id) => {
    const result = evaluation();
    result.assessment.checks[id] = 0.05;
    expect(classifyJevAssessment(result, 0.95).status).toBe('approved');
    result.assessment.checks[id] = 0.06;
    expect(classifyJevAssessment(result, 0.95).status).toBe('manual');
    result.assessment.checks[id] = 0.95;
    expect(classifyJevAssessment(result, 0.95).status).toBe('rejected');
  });

  it.each(['goal_alignment', 'in_scope'] as const)('rejects confident misalignment on %s', (id) => {
    const result = evaluation();
    result.assessment.checks[id] = 0.01;
    expect(classifyJevAssessment(result, 0.95).status).toBe('rejected');
  });

  it('insufficient evidence alone requires manual review', () => {
    const result = evaluation();
    result.assessment.checks.evidence_sufficient = 0;
    expect(classifyJevAssessment(result, 0.95).status).toBe('manual');
  });

  it.each([NaN, Infinity, -0.1, 1.1, '0.99', undefined])('fails closed for invalid scores %s', (value) => {
    const result = evaluation();
    Object.assign(result.assessment.checks, { goal_alignment: value });
    expect(classifyJevAssessment(result, 0.95).status).toBe('manual');
  });

  it('fails closed on extra or missing checks and missing validation function', () => {
    const extra = evaluation();
    Object.assign(extra.assessment.checks, { approval: 1 });
    expect(classifyJevAssessment(extra, 0.95).status).toBe('manual');
    const missing = evaluation();
    Reflect.deleteProperty(missing.assessment.checks, 'in_scope');
    expect(classifyJevAssessment(missing, 0.95).status).toBe('manual');
    const noValidator = evaluation();
    Reflect.deleteProperty(noValidator, 'validateContext');
    expect(classifyJevAssessment(noValidator, 0.95).status).toBe('manual');
  });

  it.each([NaN, Infinity, 0.5, 0, 1.1])('fails closed on invalid threshold %s', (threshold) => {
    expect(classifyJevAssessment(evaluation(), threshold).status).toBe('manual');
  });

  it('reports all exact scores and metadata, without invoking the freshness callback', () => {
    const result = evaluation();
    result.validateContext = () => { throw new Error('pure classifier must not consume'); };
    const { reason } = classifyJevAssessment(result, 0.95);
    for (const [id, value] of Object.entries(result.assessment.checks)) expect(reason).toContain(`${id}=${value}`);
    expect(reason).toContain('jev-test');
    expect(reason).toContain('a'.repeat(64));
  });

  it.each(['', 'fp-1', 'A'.repeat(64), 'a'.repeat(65)])('requires a bounded lowercase SHA fingerprint: %s', (contextFingerprint) => {
    const result = evaluation();
    result.assessment.contextFingerprint = contextFingerprint;
    expect(classifyJevAssessment(result, 0.95)).toEqual({ status: 'manual', reason: 'Invalid Jev assessment requires manual review.' });
  });

  it('bounds audit model metadata', () => {
    const result = evaluation();
    result.model = 'm'.repeat(256);
    expect(classifyJevAssessment(result, 0.95).status).toBe('approved');
    result.model += 'm';
    expect(classifyJevAssessment(result, 0.95).status).toBe('manual');
  });
});
