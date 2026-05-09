import { describe, expect, it } from 'vitest';
import type { RAAppGroup, RAAppSummary } from '@kalio/types';
import { bucketCatalogApps } from './catalog.utils';

function makeApp(id: string, source: 'core' | 'user'): RAAppSummary {
  return {
    id,
    name: id,
    description: '',
    version: '1.0.0',
    tags: [],
    expose_as_tool: false,
    tool_description: '',
    source,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('bucketCatalogApps', () => {
  it('keeps standalone generated user apps visible in catalog', () => {
    const flatApps: RAAppSummary[] = [
      makeApp('core-1', 'core'),
      makeApp('generated-cat-app', 'user'),
    ];
    const groups: RAAppGroup[] = [];

    const result = bucketCatalogApps(flatApps, groups);

    expect(result.coreApps.map((a) => a.id)).toEqual(['core-1']);
    expect(result.userStandaloneApps.map((a) => a.id)).toEqual(['generated-cat-app']);
  });

  it('filters out user apps already represented by version groups', () => {
    const flatApps: RAAppSummary[] = [
      makeApp('my-app', 'user'),
      makeApp('generated-other', 'user'),
    ];
    const groups: RAAppGroup[] = [
      {
        slug: 'my-app',
        name: 'My App',
        source: 'user',
        current: {
          version: '1.0.0',
          status: 'current',
          zipPath: '/tmp/current.zip',
          createdAt: 1,
          meta: { id: 'my-app', name: 'My App', version: '1.0.0' },
        },
        history: [],
      },
    ];

    const result = bucketCatalogApps(flatApps, groups);

    expect(result.userStandaloneApps.map((a) => a.id)).toEqual(['generated-other']);
  });

  it('filters out IDs present in draft and history branches', () => {
    const flatApps: RAAppSummary[] = [
      makeApp('my-app-current', 'user'),
      makeApp('my-app-draft', 'user'),
      makeApp('my-app-history', 'user'),
      makeApp('standalone-user', 'user'),
    ];
    const groups: RAAppGroup[] = [
      {
        slug: 'my-app',
        name: 'My App',
        source: 'user',
        current: {
          version: '1.2.0',
          status: 'current',
          zipPath: '/tmp/current.zip',
          createdAt: 1,
          meta: { id: 'my-app-current', name: 'My App', version: '1.2.0' },
        },
        draft: {
          version: '1.3.0-draft',
          status: 'draft',
          zipPath: '/tmp/draft.zip',
          createdAt: 1,
          meta: { id: 'my-app-draft', name: 'My App', version: '1.3.0-draft' },
        },
        history: [
          {
            version: '1.1.0',
            status: 'archived',
            zipPath: '/tmp/history.zip',
            createdAt: 1,
            meta: { id: 'my-app-history', name: 'My App', version: '1.1.0' },
          },
        ],
      },
    ];

    const result = bucketCatalogApps(flatApps, groups);

    expect(result.userStandaloneApps.map((a) => a.id)).toEqual(['standalone-user']);
  });

  it('ignores malformed group IDs without filtering unrelated apps', () => {
    const malformed = {
      slug: 'broken',
      name: 'Broken',
      source: 'user',
      current: {
        version: '1.0.0',
        status: 'current',
        zipPath: '/tmp/current.zip',
        createdAt: 1,
        meta: { id: undefined, name: 'Broken', version: '1.0.0' },
      },
      history: [],
    } as unknown as RAAppGroup;

    const malformedApp = makeApp('ok-user', 'user');
    const weirdIdApp = { ...makeApp('ok-user-2', 'user'), id: undefined } as unknown as RAAppSummary;

    const result = bucketCatalogApps([malformedApp, weirdIdApp], [malformed]);

    expect(result.userStandaloneApps).toHaveLength(2);
    expect(result.userStandaloneApps[0].id).toBe('ok-user');
  });
});
