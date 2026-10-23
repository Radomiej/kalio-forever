import { describe, expect, it } from 'vitest';
import { createGoalPacket } from './architecture-goal-source';
import { buildGoalProposalWorkerContract, validateGoalProposalWorkerOutput } from './architecture-goal-worker-contract';

const packet = () => createGoalPacket({ messageId: 'prompt', sessionId: 'host', turnId: 'turn', content: 'Build feature', createdAt: 1 });
const proposal = { sourceVersion: 1, criteria: [{ text: 'Build feature', sourceQuotes: [{ messageId: 'prompt', quote: 'Build feature' }], supersedes: [] }] };
describe('goal proposal worker host contract', () => {
  it('intersects the verified read allowlist and strips policy/approval widening flags', () => {
    const contract = buildGoalProposalWorkerContract(packet(), { allowedToolNames: ['fs_read', 'vfs_read', 'vfs_write', 'terminal_spawn', 'run_subagent', 'spawn_cli_agent', 'unknown_mcp'], stripRequiresConfirmation: true, applyCliDescriptionPreferences: true });
    expect(contract.slotPolicy).toEqual({ allowedToolNames: ['fs_read', 'vfs_read'] });
    expect(contract.autoApproveTools).toEqual([]);
    expect(contract.structuredOutput.strict).toBe(true);
    expect(contract.structuredOutput.schema).toMatchObject({ additionalProperties: false, required: ['sourceVersion', 'criteria'] });
  });
  it('gives no tools when existing policy is missing and does not mutate input', () => {
    const original = packet();
    expect(buildGoalProposalWorkerContract(original, null).slotPolicy).toEqual({ allowedToolNames: [] });
    expect(original).toEqual(packet());
  });
  it('preserves exact validated output without parsing prose or supplying host IDs/policy', () => {
    const result = validateGoalProposalWorkerOutput(packet(), proposal);
    expect(result).toEqual(proposal);
    expect(result).not.toBe(proposal);
    expect(() => validateGoalProposalWorkerOutput(packet(), JSON.stringify(proposal))).toThrow('Invalid goal proposal.');
    expect(() => validateGoalProposalWorkerOutput(packet(), { ...proposal, completionPolicy: {} })).toThrow('Invalid goal proposal.');
    expect(() => validateGoalProposalWorkerOutput(packet(), { ...proposal, sourceVersion: 2 })).toThrow('Invalid goal proposal.');
  });
});
