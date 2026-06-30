import { describe, expect, it, vi } from 'vitest';
import type { ToolMeta } from '@kalio/types';
import { ToolPolicyService } from '../tool-policy.service';
import type { PersonaService } from '../../persona/persona.service';
import type { ToolDispatchService } from '../tool-dispatch.service';

const allTools: ToolMeta[] = [
  { name: 'vfs_read', description: 'Read VFS', parameters: {}, requiresConfirmation: false },
  { name: 'vfs_list', description: 'List VFS', parameters: {}, requiresConfirmation: false },
  { name: 'fs_read', description: 'Read host', parameters: {}, requiresConfirmation: false },
  { name: 'fs_list', description: 'List host', parameters: {}, requiresConfirmation: false },
  { name: 'fs_write', description: 'Write host', parameters: {}, requiresConfirmation: true },
  { name: 'spawn_cli_agent', description: 'Spawn CLI', parameters: {}, requiresConfirmation: true },
  { name: 'run_subagent', description: 'Run subagent', parameters: {}, requiresConfirmation: false },
  { name: 'terminal_spawn', description: 'Terminal', parameters: {}, requiresConfirmation: true },
];

function makeService(
  personaAllowed: string[],
  mcpPolicy: 'allow_all' | 'deny_all' | 'allow_list' = 'allow_all',
  extraTools: ToolMeta[] = [],
): ToolPolicyService {
  const tools = [...allTools, ...extraTools];
  const personaService = {
    getSessionConfig: vi.fn().mockResolvedValue({
      systemPrompt: 'base',
      model: 'mock',
      allowedTools: personaAllowed,
      skillIds: [],
      mcpPolicy,
      kv: {},
    }),
  } as unknown as PersonaService;
  const toolDispatch = {
    getToolMetas: vi.fn().mockReturnValue(tools),
  } as unknown as ToolDispatchService;
  return new ToolPolicyService(personaService, toolDispatch);
}

function makeServiceWithToolCatalog(
  personaAllowed: string[],
  toolCatalog: ToolMeta[],
): ToolPolicyService {
  const personaService = {
    getSessionConfig: vi.fn().mockResolvedValue({
      systemPrompt: 'base',
      model: 'mock',
      allowedTools: personaAllowed,
      skillIds: [],
      mcpPolicy: 'allow_all',
      kv: {},
    }),
  } as unknown as PersonaService;
  const toolDispatch = {
    getToolMetas: vi.fn().mockReturnValue(toolCatalog),
  } as unknown as ToolDispatchService;
  return new ToolPolicyService(personaService, toolDispatch);
}

describe('ToolPolicyService', () => {
  it('chat uses exactly persona.allowedTools', async () => {
    const service = makeService(['vfs_read', 'vfs_list']);
    const decision = await service.decide({ runtimeKind: 'chat', personaId: 'qa' });
    expect(decision.source).toBe('persona');
    expect(decision.allowedToolNames).toEqual(['vfs_read', 'vfs_list']);
  });

  it('subagent respects explicitToolNames within runtime constraints', async () => {
    const service = makeService(['vfs_read', 'fs_read', 'fs_list']);
    const decision = await service.decide({
      runtimeKind: 'subagent',
      personaId: 'qa',
      explicitToolNames: ['vfs_read', 'fs_read'],
      architectureContext: { projectPath: 'C:\\demo' },
    });
    expect(decision.source).toBe('runtime-explicit');
    expect(decision.allowedToolNames).toEqual(['vfs_read', 'fs_read']);
  });

  it('subagent treats an explicit empty tool list as no tools', async () => {
    const service = makeService(['vfs_read', 'run_subagent']);
    const decision = await service.decide({
      runtimeKind: 'subagent',
      personaId: 'qa',
      explicitToolNames: [],
      explicitTools: [],
    });

    expect(decision.source).toBe('runtime-explicit');
    expect(decision.allowedToolNames).toEqual([]);
  });

  it('subagent resolves explicit runtime tools even when they are absent from the global catalog', async () => {
    const explicitTool = { name: 'run_cli_agent', description: 'CLI', parameters: {}, requiresConfirmation: true };
    const service = makeServiceWithToolCatalog([], []);
    const decision = await service.decide({
      runtimeKind: 'subagent',
      personaId: 'qa',
      explicitToolNames: ['run_cli_agent'],
      explicitTools: [explicitTool],
    });

    expect(decision.source).toBe('runtime-explicit');
    expect(decision.allowedToolNames).toEqual(['run_cli_agent']);
    expect(decision.tools).toEqual([explicitTool]);
  });

  it('allow-list personas translate unique legacy MCP names at the read boundary', async () => {
    const service = makeService(
      ['mcp_docs_search'],
      'allow_list',
      [{ name: 'mcp_toml::docs_search', aliases: ['mcp_docs_search'], description: 'MCP docs search', parameters: {}, requiresConfirmation: false, serverKey: 'toml::docs' }],
    );
    const decision = await service.decide({
      runtimeKind: 'chat',
      personaId: 'qa',
    });

    expect(decision.source).toBe('persona');
    expect(decision.allowedToolNames).toEqual(['mcp_toml::docs_search']);
  });

  it('subagent explicit legacy MCP names translate when canonical target is unique', async () => {
    const service = makeService(
      ['vfs_read'],
      'allow_all',
      [{ name: 'mcp_toml::docs_search', aliases: ['mcp_docs_search'], description: 'MCP docs search', parameters: {}, requiresConfirmation: false, serverKey: 'toml::docs' }],
    );
    const decision = await service.decide({
      runtimeKind: 'subagent',
      personaId: 'qa',
      explicitToolNames: ['mcp_docs_search'],
      architectureContext: { projectPath: 'C:\\demo' },
    });

    expect(decision.source).toBe('runtime-explicit');
    expect(decision.allowedToolNames).toEqual(['mcp_toml::docs_search']);
  });

  it('does not translate legacy MCP names without explicit alias metadata', async () => {
    const service = makeService(
      ['mcp_docs_search'],
      'allow_list',
      [{ name: 'mcp_toml::docs_search', description: 'MCP docs search', parameters: {}, requiresConfirmation: false, serverKey: 'toml::docs' }],
    );
    const decision = await service.decide({
      runtimeKind: 'chat',
      personaId: 'qa',
    });

    expect(decision.allowedToolNames).toEqual([]);
  });

  it('does not allow native tools only because their name uses the legacy mcp prefix', async () => {
    const service = makeService(
      ['vfs_read'],
      'allow_all',
      [{ name: 'mcp_fake_native', description: 'Not actually MCP', parameters: {}, requiresConfirmation: false }],
    );

    const decision = await service.decide({
      runtimeKind: 'subagent',
      personaId: 'qa',
      explicitToolNames: ['mcp_fake_native'],
    });

    expect(decision.allowedToolNames).toEqual([]);
    expect(decision.denied).toContainEqual({
      name: 'mcp_fake_native',
      reason: 'not_in_persona_allowlist',
    });
  });

  it('classifies MCP tools by serverKey instead of name prefix', async () => {
    const service = makeService(
      [],
      'deny_all',
      [{
        name: 'docs_search',
        description: 'MCP docs search',
        parameters: {},
        requiresConfirmation: false,
        serverKey: 'toml::docs',
      }],
    );

    const decision = await service.decide({
      runtimeKind: 'chat',
      personaId: 'qa',
    });

    expect(decision.allowedToolNames).toEqual(allTools.map((tool) => tool.name));
    expect(decision.allowedToolNames).not.toContain('docs_search');
  });

  it('agent-flow-branch intersects persona, slot policy, and runtime context', async () => {
    const service = makeService(['vfs_read', 'fs_read', 'fs_list', 'spawn_cli_agent']);
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'qa',
      slotPolicy: { allowedToolNames: ['vfs_read', 'fs_read', 'fs_list'] },
      architectureContext: { projectPath: 'C:\\demo' },
    });
    expect(decision.source).toBe('merged');
    expect(decision.allowedToolNames).toEqual(['vfs_read', 'fs_read', 'fs_list']);
    expect(decision.allowedToolNames).not.toContain('spawn_cli_agent');
  });

  it('agent-flow-branch honors launchAllowedToolNames even when branch persona is narrower', async () => {
    const service = makeService(['vfs_read']);
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'qa',
      slotPolicy: { allowedToolNames: ['vfs_read', 'fs_read'] },
      architectureContext: {
        projectPath: 'C:\\demo',
        launchAllowedToolNames: ['vfs_read', 'fs_read'],
      },
    });
    expect(decision.allowedToolNames).toEqual(['vfs_read', 'fs_read']);
  });

  it('agent-flow-branch without launchAllowedToolNames keeps slot-granted repo tools even when persona is narrower', async () => {
    const service = makeService(['vfs_read']);
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'qa',
      slotPolicy: { allowedToolNames: ['vfs_read', 'fs_read'] },
      architectureContext: {
        projectPath: 'C:\\demo',
      },
    });
    expect(decision.allowedToolNames).toEqual(['vfs_read', 'fs_read']);
    expect(decision.denied).not.toEqual(
      expect.arrayContaining([
        { name: 'fs_read', reason: 'not_in_persona_allowlist' },
      ]),
    );
  });

  it('agent-flow-branch respects an explicit empty launchAllowedToolNames baseline', async () => {
    const service = makeService(['vfs_read', 'fs_read']);
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'qa',
      slotPolicy: { allowedToolNames: ['vfs_read', 'fs_read'] },
      architectureContext: {
        projectPath: 'C:\\demo',
        launchAllowedToolNames: [],
      },
    });
    expect(decision.allowedToolNames).toEqual([]);
    expect(decision.denied).toEqual(
      expect.arrayContaining([
        { name: 'vfs_read', reason: 'not_in_runtime_explicit_list' },
        { name: 'fs_read', reason: 'not_in_runtime_explicit_list' },
      ]),
    );
  });

  it('chat keeps persona-allowed host FS and terminal tools even without architecture launch scope', async () => {
    const service = makeService(['fs_read', 'fs_list', 'terminal_spawn', 'vfs_read']);
    const decision = await service.decide({
      runtimeKind: 'chat',
      personaId: 'qa',
    });
    expect(decision.allowedToolNames).toEqual(['vfs_read', 'fs_read', 'fs_list', 'terminal_spawn']);
    expect(decision.denied).not.toEqual(
      expect.arrayContaining([
        { name: 'fs_read', reason: 'missing_project_path' },
        { name: 'fs_list', reason: 'missing_project_path' },
        { name: 'terminal_spawn', reason: 'missing_execution_cwd' },
      ]),
    );
  });

  it('denies spawn_cli_agent when CLI is unavailable', async () => {
    const service = makeService(['spawn_cli_agent', 'vfs_read']);
    const decision = await service.decide({
      runtimeKind: 'chat',
      personaId: 'p1',
      architectureContext: { architectureCliAgentsEnabled: false },
    });
    expect(decision.allowedToolNames).toEqual(['vfs_read']);
    expect(decision.denied).toContainEqual({ name: 'spawn_cli_agent', reason: 'cli_unavailable' });
  });

  it('denies CLI-domain tools when CLI is unavailable even if the tool name changes', async () => {
    const service = makeService(
      ['delegate_cli', 'vfs_read'],
      'allow_all',
      [{ name: 'delegate_cli', description: 'Delegate to CLI', parameters: {}, requiresConfirmation: false, domain: 'cli_agent' }],
    );
    const decision = await service.decide({
      runtimeKind: 'chat',
      personaId: 'p1',
      architectureContext: { architectureCliAgentsEnabled: false },
    });

    expect(decision.allowedToolNames).toEqual(['vfs_read']);
    expect(decision.denied).toContainEqual({ name: 'delegate_cli', reason: 'cli_unavailable' });
  });

  it('denies run_subagent when subagent depth limit is exceeded', async () => {
    const service = makeService(['run_subagent', 'vfs_read']);
    const decision = await service.decide({
      runtimeKind: 'subagent',
      personaId: 'p1',
      subagentDepth: 2,
    });
    expect(decision.allowedToolNames).toEqual(['vfs_read']);
    expect(decision.denied).toContainEqual({ name: 'run_subagent', reason: 'subagent_depth_limit' });
  });

  it('denies subagent-domain tools when subagent depth limit is exceeded even if the tool name changes', async () => {
    const service = makeService(
      ['delegate_child', 'vfs_read'],
      'allow_all',
      [{ name: 'delegate_child', description: 'Delegate child work', parameters: {}, requiresConfirmation: false, domain: 'subagent' }],
    );
    const decision = await service.decide({
      runtimeKind: 'subagent',
      personaId: 'p1',
      subagentDepth: 2,
    });

    expect(decision.allowedToolNames).toEqual(['vfs_read']);
    expect(decision.denied).toContainEqual({ name: 'delegate_child', reason: 'subagent_depth_limit' });
  });

  it('QA persona with projectPath includes host FS tools in agent-flow-branch', async () => {
    const service = makeService(['fs_read', 'fs_list', 'vfs_read']);
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'qa',
      slotPolicy: {
        allowedToolNames: ['vfs_read', 'vfs_list', 'fs_read', 'fs_list'],
      },
      architectureContext: { projectPath: 'C:\\Projekty\\demo' },
    });
    expect(decision.allowedToolNames).toEqual(expect.arrayContaining(['fs_read', 'fs_list']));
  });

  it('applies architecture CLI preferences to allowed CLI tool descriptions', async () => {
    const service = makeService(['spawn_cli_agent']);
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'p1',
      slotPolicy: {
        allowedToolNames: ['spawn_cli_agent'],
        applyCliDescriptionPreferences: true,
      },
      architectureContext: {
        cliAgentToolPreferences: {
          copilot: { model: 'gpt-4.1', preference: 'Prefer cheap implementation.' },
          gemini: { model: 'gemini-2.5-pro', preference: 'Use for brainstorming.' },
        },
      },
    });
    expect(decision.tools[0]?.description).toContain('copilot (model gpt-4.1): Prefer cheap implementation.');
    expect(decision.tools[0]?.description).toContain('gemini (model gemini-2.5-pro): Use for brainstorming.');
  });

  it('QA persona without projectPath excludes host FS and reports missing_project_path', async () => {
    const service = makeService(['fs_read', 'fs_list', 'vfs_read']);
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'qa',
      slotPolicy: {
        allowedToolNames: ['vfs_read', 'vfs_list', 'fs_read', 'fs_list'],
      },
    });
    expect(decision.allowedToolNames).toEqual(['vfs_read', 'vfs_list']);
    expect(decision.denied).toEqual(
      expect.arrayContaining([
        { name: 'fs_read', reason: 'missing_project_path' },
        { name: 'fs_list', reason: 'missing_project_path' },
      ]),
    );
  });

  it('denies file-system-domain tools without projectPath even if the tool name changes', async () => {
    const service = makeService(
      ['project_read', 'vfs_read'],
      'allow_all',
      [{ name: 'project_read', description: 'Read host project', parameters: {}, requiresConfirmation: false, domain: 'file_system' }],
    );
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'qa',
      slotPolicy: {
        allowedToolNames: ['vfs_read', 'project_read'],
      },
    });

    expect(decision.allowedToolNames).toEqual(['vfs_read']);
    expect(decision.denied).toContainEqual({ name: 'project_read', reason: 'missing_project_path' });
  });

  it('agent-flow-branch with inherited projectPath allows host FS and terminal tools', async () => {
    const service = makeService(['fs_read', 'fs_list', 'terminal_spawn', 'vfs_read']);
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'qa',
      slotPolicy: {
        allowedToolNames: ['vfs_read', 'fs_read', 'fs_list', 'terminal_spawn'],
      },
      architectureContext: {
        projectPath: 'C:\\Projekty\\demo',
        executionCwd: 'C:\\Projekty\\demo',
      },
    });
    expect(decision.allowedToolNames).toEqual(
      expect.arrayContaining(['fs_read', 'fs_list', 'terminal_spawn']),
    );
  });

  it('agent-flow-branch missing inherited context adds a specific scope warning', async () => {
    const service = makeService(['fs_read', 'fs_list', 'vfs_read']);
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'qa',
      slotPolicy: {
        allowedToolNames: ['vfs_read', 'vfs_list', 'fs_read', 'fs_list'],
      },
    });
    expect(decision.warnings).toContain(
      'Host filesystem tools require inherited projectPath from launch settings; child flow context is missing project scope.',
    );
  });

  it('agent-flow-branch missing executionCwd warns specifically about terminal scope', async () => {
    const service = makeService(['terminal_spawn', 'vfs_read']);
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'qa',
      slotPolicy: {
        allowedToolNames: ['vfs_read', 'terminal_spawn'],
      },
      architectureContext: {
        launchAllowedToolNames: ['vfs_read', 'terminal_spawn'],
      },
    });
    expect(decision.allowedToolNames).toEqual(['vfs_read']);
    expect(decision.warnings).toContain(
      'Terminal tools require inherited executionCwd from launch settings; child flow context is missing execution scope.',
    );
  });

  it('agent-flow-branch with orchestratorScopeRestriction reports intentional narrowing', async () => {
    const service = makeService(['fs_read', 'fs_list', 'vfs_read']);
    const decision = await service.decide({
      runtimeKind: 'agent-flow-branch',
      personaId: 'qa',
      slotPolicy: {
        allowedToolNames: ['vfs_read', 'vfs_list', 'fs_read', 'fs_list'],
      },
      architectureContext: {
        orchestratorScopeRestriction: { reason: 'folder scoped run' },
      },
    });
    expect(decision.warnings).toContain(
      'Host filesystem/terminal tools restricted by orchestrator scope for this run.',
    );
    expect(decision.warnings).not.toContain(
      'Host filesystem tools require inherited projectPath from launch settings; child flow context is missing project scope.',
    );
  });
});
