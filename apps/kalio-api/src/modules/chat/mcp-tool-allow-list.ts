export function resolveToolAlias(toolName: string, availableToolNames: Set<string>): string | null {
  return availableToolNames.has(toolName) ? toolName : null;
}
