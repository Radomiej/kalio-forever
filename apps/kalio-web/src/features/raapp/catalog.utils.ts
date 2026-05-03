import type { RAAppGroup, RAAppSummary } from '@kalio/types';

export interface CatalogBuckets {
  coreApps: RAAppSummary[];
  userStandaloneApps: RAAppSummary[];
}

export function bucketCatalogApps(flatApps: RAAppSummary[], groups: RAAppGroup[]): CatalogBuckets {
  const groupedIds = new Set<string>();
  for (const group of groups) {
    groupedIds.add(group.current.meta.id);
    if (group.draft) groupedIds.add(group.draft.meta.id);
    for (const item of group.history) groupedIds.add(item.meta.id);
  }

  const coreApps = flatApps.filter((app) => app.source === 'core');
  const userStandaloneApps = flatApps.filter((app) => app.source === 'user' && !groupedIds.has(app.id));

  return { coreApps, userStandaloneApps };
}
