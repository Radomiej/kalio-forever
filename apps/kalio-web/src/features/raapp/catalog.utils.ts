import type { RAAppGroup, RAAppSummary } from '@kalio/types';

export interface CatalogBuckets {
  coreApps: RAAppSummary[];
  userStandaloneApps: RAAppSummary[];
}

export function bucketCatalogApps(flatApps: RAAppSummary[], groups: RAAppGroup[]): CatalogBuckets {
  const groupedIds = new Set<string>();
  for (const group of groups) {
    const currentId = group.current?.meta?.id;
    if (typeof currentId === 'string' && currentId.length > 0) groupedIds.add(currentId);

    const draftId = group.draft?.meta?.id;
    if (typeof draftId === 'string' && draftId.length > 0) groupedIds.add(draftId);

    for (const item of group.history) {
      const historyId = item?.meta?.id;
      if (typeof historyId === 'string' && historyId.length > 0) groupedIds.add(historyId);
    }
  }

  const coreApps = flatApps.filter((app) => app.source === 'core');
  const userStandaloneApps = flatApps.filter((app) => app.source === 'user' && !groupedIds.has(app.id));

  return { coreApps, userStandaloneApps };
}
