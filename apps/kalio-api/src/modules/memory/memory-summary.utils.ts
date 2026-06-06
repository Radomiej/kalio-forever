import type { MemoryScopeSummary, MemorySearchResult } from '@kalio/types';

export function buildMemoryScopeSummary(
  personas: Array<{ id: string; name: string }>,
  getPersonaEntries: (personaId: string) => MemorySearchResult[],
  webEntries: MemorySearchResult[]
): MemoryScopeSummary {
  const personaStats = personas.map((persona) => {
    const entries = getPersonaEntries(persona.id);
    return {
      id: persona.id,
      label: persona.name,
      count: entries.length,
      size: entries.reduce((total, entry) => total + entry.content.length, 0),
    };
  });
  const webSearch = {
    id: 'web_search',
    label: 'Web search',
    count: webEntries.length,
    size: webEntries.reduce((total, entry) => total + entry.content.length, 0),
  };
  return {
    totalCount: webSearch.count + personaStats.reduce((total, stat) => total + stat.count, 0),
    totalSize: webSearch.size + personaStats.reduce((total, stat) => total + stat.size, 0),
    webSearch,
    personas: personaStats,
  };
}
