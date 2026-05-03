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
});
