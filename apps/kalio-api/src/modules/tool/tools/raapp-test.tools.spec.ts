import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCallRequest } from '@kalio/types';
import { RaAppTestTool } from './raapp-test.tools';

const TESTS_YML = `tests:
  - name: sums
    input:
      score: 1
    expect:
      total: 2
`;

const SYSTEMS_YML = `systems:
  - id: setup
    effects: []
  - id: combat
    effects: []
`;

function makeRequest(args: Record<string, unknown>): ToolCallRequest {
  return {
    callId: 'call-1',
    sessionId: 'sess-1',
    toolName: 'raapp_test',
    args,
  };
}

describe('RaAppTestTool', () => {
  let raapp: {
    getById: ReturnType<typeof vi.fn>;
    getSourceFiles: ReturnType<typeof vi.fn>;
  };
  let effectsProcessor: {
    processSystemsYaml: ReturnType<typeof vi.fn>;
  };
  let vfs: {
    readFile: ReturnType<typeof vi.fn>;
  };
  let tool: RaAppTestTool;

  beforeEach(() => {
    raapp = {
      getById: vi.fn(),
      getSourceFiles: vi.fn(),
    };
    effectsProcessor = {
      processSystemsYaml: vi.fn().mockResolvedValue({
        output: { total: 2 },
        pendingApprovals: [],
        entities: [],
      }),
    };
    vfs = {
      readFile: vi.fn((sessionId: string, filePath: string) => {
        if (filePath.endsWith('tests.yml')) {
          return { sessionId, filePath, content: TESTS_YML };
        }
        if (filePath.endsWith('systems.yml')) {
          return { sessionId, filePath, content: 'systems: []' };
        }
        const err = new Error(`missing: ${filePath}`) as NodeJS.ErrnoException;
        err.code = 'VFS_FILE_NOT_FOUND';
        throw err;
      }),
    };
    tool = new (
      RaAppTestTool as unknown as {
        new (...args: unknown[]): RaAppTestTool;
      }
    )(raapp as never, effectsProcessor as never, vfs as never);
  });

  it('tests a stored release app by id', async () => {
    raapp.getById.mockReturnValue({ systemsContent: 'systems: []' });
    raapp.getSourceFiles.mockResolvedValue({ 'tests.yml': TESTS_YML });

    const result = await tool.execute(makeRequest({ id: 'release-app' }));

    expect(result).toMatchObject({
      status: 'all_passed',
      app_id: 'release-app',
      total: 1,
      passed: 1,
      failed: 0,
    });
    expect(raapp.getSourceFiles).toHaveBeenCalledWith('release-app');
  });

  it('tests a raw VFS draft by draft_id', async () => {
    const result = await tool.execute(makeRequest({ draft_id: 'draft-1' }));

    expect(result).toMatchObject({
      status: 'all_passed',
      draft_id: 'draft-1',
      total: 1,
      passed: 1,
      failed: 0,
    });
    expect(vfs.readFile).toHaveBeenCalledWith('sess-1', 'drafts/draft-1/tests.yml');
  });

  it('filters systems.yml to the systems declared by each test case', async () => {
    const selectiveTests = `tests:
  - name: combat only
    systems: [combat]
    input: {}
    expect:
      total: 2
`;

    vfs.readFile.mockImplementation((sessionId: string, filePath: string) => {
      if (filePath.endsWith('tests.yml')) {
        return { sessionId, filePath, content: selectiveTests };
      }
      if (filePath.endsWith('systems.yml')) {
        return { sessionId, filePath, content: SYSTEMS_YML };
      }
      const err = new Error(`missing: ${filePath}`) as NodeJS.ErrnoException;
      err.code = 'VFS_FILE_NOT_FOUND';
      throw err;
    });

    await tool.execute(makeRequest({ draft_id: 'draft-1' }));

    expect(effectsProcessor.processSystemsYaml).toHaveBeenCalledTimes(1);
    const filteredSystems = effectsProcessor.processSystemsYaml.mock.calls[0][0] as string;
    expect(filteredSystems).toContain('id: combat');
    expect(filteredSystems).not.toContain('id: setup');
  });

  it('returns a validation error when a draft test run has no systems.yml', async () => {
    vfs.readFile.mockImplementation((sessionId: string, filePath: string) => {
      if (filePath.endsWith('tests.yml')) {
        return { sessionId, filePath, content: TESTS_YML };
      }
      const err = new Error(`missing: ${filePath}`) as NodeJS.ErrnoException;
      err.code = 'VFS_FILE_NOT_FOUND';
      throw err;
    });

    const result = await tool.execute(makeRequest({ draft_id: 'draft-1' }));

    expect(result).toEqual({
      status: 'error',
      message: 'Draft "draft-1" has no systems.yml. Add systems logic to the draft first.',
    });
  });

  it('returns a validation error when a stored release has no systems.yml', async () => {
    raapp.getById.mockReturnValue({ systemsContent: null });
    raapp.getSourceFiles.mockResolvedValue({ 'tests.yml': TESTS_YML });

    const result = await tool.execute(makeRequest({ id: 'release-app' }));

    expect(result).toEqual({
      status: 'error',
      message: 'RA-App "release-app" has no systems.yml. Add systems logic to the app first.',
    });
  });

  it('supports expect.entities matchers documented in the RaBuilder persona', async () => {
    const entityTests = `tests:
  - name: player starts with 100hp
    input: {}
    expect:
      entities:
        - component: stats
          field: hp
          value: 100
  - name: combat reduces hp
    systems: [combat]
    input: {}
    expect:
      entities:
        - component: stats
          field: hp
          operator: "<"
          value: 100
`;

    raapp.getById.mockReturnValue({ systemsContent: SYSTEMS_YML });
    raapp.getSourceFiles.mockResolvedValue({ 'tests.yml': entityTests });
    effectsProcessor.processSystemsYaml
      .mockResolvedValueOnce({
        output: {},
        pendingApprovals: [],
        entities: [{ id: 'player', components: { stats: { hp: 100 } } }],
      })
      .mockResolvedValueOnce({
        output: {},
        pendingApprovals: [],
        entities: [{ id: 'player', components: { stats: { hp: 80 } } }],
      });

    const result = await tool.execute(makeRequest({ id: 'release-app' }));

    expect(result).toMatchObject({
      status: 'all_passed',
      app_id: 'release-app',
      total: 2,
      passed: 2,
      failed: 0,
    });
  });

  it('returns a validation error when neither id nor draft_id is provided', async () => {
    const result = await tool.execute(makeRequest({}));

    expect(result).toEqual({
      status: 'error',
      message: 'Either id or draft_id is required.',
    });
  });
});