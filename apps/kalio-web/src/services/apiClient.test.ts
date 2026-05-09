import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RAAppGroup, RAAppSummary } from '@kalio/types';

const { axiosCreate, mockGet, mockPost, mockDelete } = vi.hoisted(() => ({
  axiosCreate: vi.fn(),
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    create: axiosCreate,
  },
}));

import {
  apiClient,
  approveRAAppDraft,
  deleteRAAppGroup,
  discardRAAppDraft,
  getRAAppGroups,
  getRAApps,
  rollbackRAApp,
  uploadRAApp,
} from './apiClient';

describe('apiClient helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axiosCreate.mockReturnValue({
      get: mockGet,
      post: mockPost,
      delete: mockDelete,
    });
  });

  it('creates the shared axios client with JSON defaults', async () => {
    vi.resetModules();

    const module = await import('./apiClient');

    expect(axiosCreate).toHaveBeenCalledWith({
      baseURL: expect.any(String),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(module.apiClient).toBeDefined();
  });

  it('fetches RA-App summaries and groups through the shared client', async () => {
    const apps: RAAppSummary[] = [{
      id: 'app-1',
      name: 'App One',
      description: '',
      version: '1.0.0',
      tags: [],
      expose_as_tool: false,
      tool_description: '',
      source: 'core',
      createdAt: 1,
      updatedAt: 1,
    }];
    const groups: RAAppGroup[] = [{
      slug: 'app-1',
      name: 'App One',
      source: 'core',
      current: {
        version: '1.0.0',
        status: 'current',
        zipPath: '/tmp/app-1.zip',
        createdAt: 1,
        meta: { id: 'app-1', name: 'App One', version: '1.0.0' },
      },
      history: [],
    }];

    mockGet
      .mockResolvedValueOnce({ data: apps })
      .mockResolvedValueOnce({ data: groups });

    await expect(getRAApps()).resolves.toEqual(apps);
    await expect(getRAAppGroups()).resolves.toEqual(groups);

    expect(mockGet).toHaveBeenNthCalledWith(1, '/api/ra-apps');
    expect(mockGet).toHaveBeenNthCalledWith(2, '/api/ra-apps/groups');
  });

  it('uploads a RA-App as multipart form data', async () => {
    const summary: RAAppSummary = {
      id: 'uploaded-app',
      name: 'Uploaded App',
      description: '',
      version: '1.0.0',
      tags: [],
      expose_as_tool: false,
      tool_description: '',
      source: 'user',
      createdAt: 1,
      updatedAt: 1,
    };
    mockPost.mockResolvedValue({ data: summary });

    const file = new File(['zip'], 'app.zip', { type: 'application/zip' });
    const result = await uploadRAApp(file);

    expect(result).toEqual(summary);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/ra-apps/upload',
      expect.any(FormData),
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );

    const sentFormData = mockPost.mock.calls[0]?.[1];
    expect(sentFormData).toBeInstanceOf(FormData);
    expect((sentFormData as FormData).get('file')).toBe(file);
  });

  it('posts approve, discard, rollback, and delete requests to the correct endpoints', async () => {
    const group: RAAppGroup = {
      slug: 'cats-suite',
      name: 'Cats Suite',
      source: 'user',
      current: {
        version: '2.0.0',
        status: 'current',
        zipPath: '/tmp/cats-suite.zip',
        createdAt: 1,
        meta: { id: 'cats-suite', name: 'Cats Suite', version: '2.0.0' },
      },
      history: [],
    };
    mockPost.mockResolvedValue({ data: group });
    mockDelete.mockResolvedValue({});

    await expect(approveRAAppDraft('cats-suite', 'major')).resolves.toEqual(group);
    await expect(discardRAAppDraft('cats-suite')).resolves.toEqual(group);
    await expect(rollbackRAApp('cats-suite', '1.5.0')).resolves.toEqual(group);
    await expect(deleteRAAppGroup('cats-suite')).resolves.toBeUndefined();

    expect(mockPost).toHaveBeenNthCalledWith(1, '/api/ra-apps/groups/cats-suite/approve', { bumpType: 'major' });
    expect(mockPost).toHaveBeenNthCalledWith(2, '/api/ra-apps/groups/cats-suite/discard-draft');
    expect(mockPost).toHaveBeenNthCalledWith(3, '/api/ra-apps/groups/cats-suite/rollback/1.5.0');
    expect(mockDelete).toHaveBeenCalledWith('/api/ra-apps/groups/cats-suite');
  });

  it('exports the configured shared client instance', () => {
    expect(apiClient).toBeDefined();
  });
});
