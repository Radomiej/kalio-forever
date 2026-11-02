import { describe, expect, it } from 'vitest';
import type { ArchitectureGoalCriterionV1 } from '@kalio/types';
import { codingGoalCompletionPolicy } from './architecture-coding-goal-policy';
import { createGoalPacket } from './architecture-goal-source';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import { inspectGoalCompletion } from './architecture-goal-completion';

const criterion = (id: string): ArchitectureGoalCriterionV1 => ({ id, text: 'Approved coding work', sourceQuotes: [], supersedes: [] });

describe('coding goal default completion policy', () => {
  it('keeps the actual completion inspector ineligible until both required kinds pass', () => {
    const pending = createGoalPacket({ messageId: 'human', sessionId: 'host', turnId: 'turn',
      content: 'Build the approved home site.', createdAt: 1 });
    const proposal = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [{
      text: 'Build the approved home site', sourceQuotes: [{ messageId: 'human', quote: 'Build the approved home site' }], supersedes: [],
    }] });
    pending.projection = { status: 'pending', base: null, proposal };
    const active = goalProjectionPolicyTargets(pending, proposal);
    const packet = acceptGoalProjection(pending, proposal, codingGoalCompletionPolicy(active), {
      sourceVersion: 1, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true,
    });
    const refs = { [active[0]!.id]: ['build', 'review'] };
    const host = { evidenceById: { build: { kind: 'BUILD_RESULT' as const, status: 'passed' as const },
      review: { kind: 'QUALITY_GATE' as const, status: 'failed' as 'passed' | 'failed' } }, cliChildrenById: {} };
    expect(inspectGoalCompletion(packet, refs, host).eligible).toBe(false);
    host.evidenceById.review.status = 'passed';
    expect(inspectGoalCompletion(packet, refs, host).eligible).toBe(true);
    // Structural policy consumption only: no claim of V2 provenance or reviewer authority.
  });

  it('requires build and independently verified review for every active criterion', () => {
    const active = [criterion('first'), criterion('second')];
    const before = structuredClone(active);
    expect(codingGoalCompletionPolicy(active)).toEqual({ requiredEvidenceKindsByCriterion: {
      first: ['BUILD_RESULT', 'QUALITY_GATE'], second: ['BUILD_RESULT', 'QUALITY_GATE'],
    } });
    expect(active).toEqual(before);
  });

  it('does not require git or publication and isolates returned policy values', () => {
    const first = codingGoalCompletionPolicy([criterion('first'), criterion('second')]);
    Reflect.set(first.requiredEvidenceKindsByCriterion.first!, 0, 'GIT_STATUS');
    expect(first.requiredEvidenceKindsByCriterion.second).toEqual(['BUILD_RESULT', 'QUALITY_GATE']);
    expect(codingGoalCompletionPolicy([criterion('first')]).requiredEvidenceKindsByCriterion.first)
      .toEqual(['BUILD_RESULT', 'QUALITY_GATE']);
  });

  it.each([{ active: [] }, { active: [criterion('')] }, { active: [criterion(' x')] },
    { active: [criterion('x'), criterion('x')] }])(
    'rejects missing or ambiguous active criteria without including their text in errors', ({ active }) => {
      expect(() => codingGoalCompletionPolicy(active)).toThrow('GOAL_CODING_POLICY_INVALID');
    },
  );
});
