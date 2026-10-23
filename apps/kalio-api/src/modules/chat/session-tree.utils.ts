export function sessionDescendantIds(
  id: string,
  rows: readonly { id: string; parentSessionId: string | null }[],
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentSessionId) continue;
    childrenByParent.set(row.parentSessionId, [...(childrenByParent.get(row.parentSessionId) ?? []), row.id]);
  }
  const result: string[] = [];
  const pending = [id];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const currentId = pending.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    result.push(currentId);
    pending.push(...(childrenByParent.get(currentId) ?? []));
  }
  return result;
}
