import { describe, it, expect, vi } from 'vitest';
import { SkillReadTool, SkillListTool } from './skill.tools';
import type { SkillsService } from '../../skills/skills.service';
import type { Skill } from '@kalio/types';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'Python Expert',
    description: 'Expert in Python',
    prompt: 'You are a Python expert.',
    source: 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeRequest(args: Record<string, unknown>) {
  return { sessionId: 's1', toolName: 'skill_read', callId: 'c1', args } as Parameters<SkillReadTool['execute']>[0];
}

// ─── SkillReadTool — regression: must use findOne(id), NOT findAll() ──────────

describe('SkillReadTool.execute()', () => {
  it('uses findOne(id) when id is provided — NOT findAll', async () => {
    const skillsService = {
      findOne: vi.fn().mockResolvedValue(makeSkill()),
      findAll: vi.fn(),
    } as unknown as SkillsService;

    const tool = new SkillReadTool(skillsService);
    await tool.execute(makeRequest({ id: 'skill-1' }));

    // findOne must be called with the exact id
    expect(skillsService.findOne).toHaveBeenCalledWith('skill-1');
    // findAll must NOT be called — that was the old inefficient path
    expect(skillsService.findAll).not.toHaveBeenCalled();
  });

  it('falls back to findAll() for name lookup when id is not provided', async () => {
    const skillsService = {
      findOne: vi.fn(),
      findAll: vi.fn().mockResolvedValue([makeSkill({ name: 'Python Expert' })]),
    } as unknown as SkillsService;

    const tool = new SkillReadTool(skillsService);
    const result = await tool.execute(makeRequest({ name: 'python expert' }));

    expect(skillsService.findOne).not.toHaveBeenCalled();
    expect(skillsService.findAll).toHaveBeenCalledTimes(1);
    expect(result.name).toBe('Python Expert');
  });

  it('name lookup is case-insensitive', async () => {
    const skillsService = {
      findOne: vi.fn(),
      findAll: vi.fn().mockResolvedValue([makeSkill({ name: 'PYTHON EXPERT' })]),
    } as unknown as SkillsService;

    const tool = new SkillReadTool(skillsService);
    const result = await tool.execute(makeRequest({ name: 'python expert' }));

    expect(result.name).toBe('PYTHON EXPERT');
  });

  it('throws when id is provided but not found', async () => {
    const skillsService = {
      findOne: vi.fn().mockResolvedValue(null),
      findAll: vi.fn(),
    } as unknown as SkillsService;

    const tool = new SkillReadTool(skillsService);
    await expect(tool.execute(makeRequest({ id: 'nonexistent' }))).rejects.toThrow('Skill not found: nonexistent');
    expect(skillsService.findAll).not.toHaveBeenCalled();
  });

  it('throws when name is provided but not found', async () => {
    const skillsService = {
      findOne: vi.fn(),
      findAll: vi.fn().mockResolvedValue([]),
    } as unknown as SkillsService;

    const tool = new SkillReadTool(skillsService);
    await expect(tool.execute(makeRequest({ name: 'ghost' }))).rejects.toThrow('Skill not found: ghost');
  });

  it('throws when neither id nor name provided', async () => {
    const skillsService = {
      findOne: vi.fn(),
      findAll: vi.fn(),
    } as unknown as SkillsService;

    const tool = new SkillReadTool(skillsService);
    await expect(tool.execute(makeRequest({}))).rejects.toThrow('Skill not found: (no id or name provided)');
  });

  it('returns all expected fields', async () => {
    const skill = makeSkill({ id: 'x', name: 'N', description: 'D', prompt: 'P', source: 'agent' });
    const skillsService = {
      findOne: vi.fn().mockResolvedValue(skill),
      findAll: vi.fn(),
    } as unknown as SkillsService;

    const tool = new SkillReadTool(skillsService);
    const result = await tool.execute(makeRequest({ id: 'x' }));

    expect(result).toEqual({ id: 'x', name: 'N', description: 'D', prompt: 'P', source: 'agent' });
  });
});

// ─── SkillListTool ────────────────────────────────────────────────────────────

describe('SkillListTool.execute()', () => {
  it('returns all skills when no source filter', async () => {
    const skills = [makeSkill({ id: '1', source: 'user' }), makeSkill({ id: '2', source: 'agent' })];
    const skillsService = { findAll: vi.fn().mockResolvedValue(skills) } as unknown as SkillsService;

    const tool = new SkillListTool(skillsService);
    const result = await tool.execute(makeRequest({}));

    expect(result.skills).toHaveLength(2);
  });

  it('filters by source when provided', async () => {
    const skills = [makeSkill({ id: '1', source: 'user' }), makeSkill({ id: '2', source: 'agent' })];
    const skillsService = { findAll: vi.fn().mockResolvedValue(skills) } as unknown as SkillsService;

    const tool = new SkillListTool(skillsService);
    const result = await tool.execute(makeRequest({ source: 'agent' }));

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.id).toBe('2');
  });

  it('omits prompt from returned objects', async () => {
    const skillsService = { findAll: vi.fn().mockResolvedValue([makeSkill()]) } as unknown as SkillsService;
    const tool = new SkillListTool(skillsService);

    const result = await tool.execute(makeRequest({}));

    expect(result.skills[0]).not.toHaveProperty('prompt');
  });
});
