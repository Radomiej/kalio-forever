import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { ChatMessage, ToolMeta } from '@kalio/types';
import { ContextPreviewService } from '../context-preview.service';
import { ContextAssemblyService } from '../context-assembly.service';
import { SessionManagerService } from '../session-manager.service';
import { SessionsService } from '../sessions.service';
import { ImageHydratorService } from '../image-hydrator.service';
import { MESSAGE_REPOSITORY } from '../chat.tokens';
import type { IMessageRepository } from '../interfaces/message-repository.interface';
import { CredentialsService } from '../../credentials/credentials.service';
import { PersonaService } from '../../persona/persona.service';
import { SkillsService } from '../../skills/skills.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { makeContextAssembly } from './llm-runtime-test-harness';

function makeRepo(messages: ChatMessage[] = []): IMessageRepository {
  return {
    ensureSession: vi.fn().mockResolvedValue(undefined),
    loadHistory: vi.fn().mockResolvedValue(messages),
    saveMessage: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ContextPreviewService', () => {
  it('builds provider-ready context preview with effective prompt, tools, history, and an unsaved draft', async () => {
    const toolMetas: ToolMeta[] = [
      { name: 'vfs_read', description: 'Read project files.', parameters: {}, requiresConfirmation: false },
    ];
    const repo = makeRepo([
      { id: 'u1', sessionId: 'sid', role: 'user', content: 'persisted question', createdAt: 1 },
      { id: 'a1', sessionId: 'sid', role: 'assistant', content: 'persisted answer', thinking: 'private reasoning', createdAt: 2 },
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContextPreviewService,
        {
          provide: ContextAssemblyService,
          useFactory: (personaService: PersonaService, skillsService: SkillsService, toolDispatch: ToolDispatchService) =>
            makeContextAssembly(personaService, toolDispatch, skillsService),
          inject: [PersonaService, SkillsService, ToolDispatchService],
        },
        SessionManagerService,
        { provide: SessionsService, useValue: { get: vi.fn().mockResolvedValue({ id: 'sid', personaId: 'persona-1', title: 't', createdAt: 1, updatedAt: 1 }) } },
        { provide: MESSAGE_REPOSITORY, useValue: repo },
        { provide: ImageHydratorService, useValue: { hydrate: vi.fn().mockResolvedValue([]) } },
        { provide: CredentialsService, useValue: { getContextWindowSize: vi.fn().mockResolvedValue(32000) } },
        {
          provide: PersonaService,
          useValue: {
            getSessionConfig: vi.fn().mockResolvedValue({
              systemPrompt: 'Persona base prompt.',
              model: 'mimo-v2.5',
              skillIds: ['skill-1'],
              allowedTools: [],
              mcpPolicy: 'allow_all',
              kv: {},
            }),
          },
        },
        {
          provide: SkillsService,
          useValue: {
            findByIds: vi.fn().mockResolvedValue([
              { id: 'skill-1', name: 'Architecture Discipline', description: 'Use the checklist.', prompt: 'Keep a delegation ledger.' },
            ]),
          },
        },
        { provide: ToolDispatchService, useValue: { getToolMetas: vi.fn().mockReturnValue(toolMetas) } },
      ],
    }).compile();

    const service = moduleRef.get(ContextPreviewService);
    const preview = await service.buildPreview('sid', {
      target: 'session',
      sessionId: 'sid',
      personaId: 'persona-1',
      draftUserMessage: 'draft question',
    });

    expect(repo.saveMessage).not.toHaveBeenCalled();
    expect(preview).toMatchObject({
      sessionId: 'sid',
      personaId: 'persona-1',
      model: 'mimo-v2.5',
      contextLimit: 32000,
      tools: toolMetas,
      compaction: {
        applied: false,
        unboundedMessageCount: 4,
        finalMessageCount: 4,
        safeTargetTokens: 25600,
      },
    });
    expect(preview.effectiveSystemPrompt).toContain('Persona base prompt.');
    expect(preview.effectiveSystemPrompt).toContain('Keep a delegation ledger.');
    expect(preview.effectiveSystemPrompt).toContain('## Available tools (1)');
    expect(preview.messages.map((message) => message.source)).toEqual(['system_prompt', 'history', 'history', 'draft']);
    expect(preview.messages.at(-1)).toMatchObject({ role: 'user', content: 'draft question', source: 'draft' });
    expect(preview.estimatedTokens.total).toBeGreaterThan(0);
    expect(preview.estimatedTokens.reasoning).toBeGreaterThan(0);
  });

  it('does not label persisted history as draft when backend compaction drops the draft', async () => {
    const repo = makeRepo([
      { id: 'u1', sessionId: 'sid', role: 'user', content: 'kept persisted question ' + 'x'.repeat(700), createdAt: 1 },
      { id: 'u2', sessionId: 'sid', role: 'user', content: 'second persisted question ' + 'y'.repeat(700), createdAt: 2 },
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContextPreviewService,
        {
          provide: ContextAssemblyService,
          useFactory: (personaService: PersonaService, skillsService: SkillsService, toolDispatch: ToolDispatchService) =>
            makeContextAssembly(personaService, toolDispatch, skillsService),
          inject: [PersonaService, SkillsService, ToolDispatchService],
        },
        SessionManagerService,
        { provide: SessionsService, useValue: { get: vi.fn().mockResolvedValue({ id: 'sid', personaId: 'persona-1', title: 't', createdAt: 1, updatedAt: 1 }) } },
        { provide: MESSAGE_REPOSITORY, useValue: repo },
        { provide: ImageHydratorService, useValue: { hydrate: vi.fn().mockResolvedValue([]) } },
        { provide: CredentialsService, useValue: { getContextWindowSize: vi.fn().mockResolvedValue(1) } },
        {
          provide: PersonaService,
          useValue: {
            getSessionConfig: vi.fn().mockResolvedValue({
              systemPrompt: 'Persona base prompt.',
              model: 'mimo-v2.5',
              skillIds: [],
              allowedTools: [],
              mcpPolicy: 'allow_all',
              kv: {},
            }),
          },
        },
        { provide: SkillsService, useValue: { findByIds: vi.fn().mockResolvedValue([]) } },
        { provide: ToolDispatchService, useValue: { getToolMetas: vi.fn().mockReturnValue([]) } },
      ],
    }).compile();

    const service = moduleRef.get(ContextPreviewService);
    const preview = await service.buildPreview('sid', {
      target: 'session',
      sessionId: 'sid',
      personaId: 'persona-1',
      draftUserMessage: 'draft that may be removed ' + 'z'.repeat(700),
    });

    expect(preview.compaction.applied).toBe(true);
    expect(preview.messages.some((message) => typeof message.content === 'string' && message.content.startsWith('draft that may be removed'))).toBe(false);
    expect(preview.messages.some((message) => message.source === 'draft')).toBe(false);
    expect(preview.messages.some((message) => message.source === 'history' && message.role === 'user')).toBe(true);
  });

  it('marks compaction as applied when fallback truncation edits a message in place', async () => {
    const repo = makeRepo([
      { id: 'u1', sessionId: 'sid', role: 'user', content: 'kept user question', createdAt: 1 },
      { id: 'a1', sessionId: 'sid', role: 'assistant', content: 'a'.repeat(12_000), createdAt: 2 },
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContextPreviewService,
        {
          provide: ContextAssemblyService,
          useFactory: (personaService: PersonaService, skillsService: SkillsService, toolDispatch: ToolDispatchService) =>
            makeContextAssembly(personaService, toolDispatch, skillsService),
          inject: [PersonaService, SkillsService, ToolDispatchService],
        },
        SessionManagerService,
        { provide: SessionsService, useValue: { get: vi.fn().mockResolvedValue({ id: 'sid', personaId: 'persona-1', title: 't', createdAt: 1, updatedAt: 1 }) } },
        { provide: MESSAGE_REPOSITORY, useValue: repo },
        { provide: ImageHydratorService, useValue: { hydrate: vi.fn().mockResolvedValue([]) } },
        { provide: CredentialsService, useValue: { getContextWindowSize: vi.fn().mockResolvedValue(2_000) } },
        {
          provide: PersonaService,
          useValue: {
            getSessionConfig: vi.fn().mockResolvedValue({
              systemPrompt: 'Persona base prompt.',
              model: 'mimo-v2.5',
              skillIds: [],
              allowedTools: [],
              mcpPolicy: 'allow_all',
              kv: {},
            }),
          },
        },
        { provide: SkillsService, useValue: { findByIds: vi.fn().mockResolvedValue([]) } },
        { provide: ToolDispatchService, useValue: { getToolMetas: vi.fn().mockReturnValue([]) } },
      ],
    }).compile();

    const service = moduleRef.get(ContextPreviewService);
    const preview = await service.buildPreview('sid', {
      target: 'session',
      sessionId: 'sid',
      personaId: 'persona-1',
    });

    expect(preview.compaction.applied).toBe(true);
    expect(preview.compaction.unboundedMessageCount).toBe(3);
    expect(preview.compaction.finalMessageCount).toBe(2);
  });
});
