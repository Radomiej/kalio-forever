// TODO: legacy fallback - accept old mcp_<serverId>_<tool> allow-list entries for one release.
export function parsePrefixedMcpToolName(toolName: string): { serverKeyPart: string; toolName: string } | null {
  if (!toolName.startsWith('mcp_')) {
    return null;
  }

  const body = toolName.slice(4);
  const separatorIndex = body.lastIndexOf('_');
  if (separatorIndex <= 0 || separatorIndex === body.length - 1) {
    return null;
  }

  return {
    serverKeyPart: body.slice(0, separatorIndex),
    toolName: body.slice(separatorIndex + 1),
  };
}

export function isServerKey(value: string): boolean {
  return value.startsWith('toml::') || value.startsWith('sqlite::');
}

export function toLegacyMcpToolName(toolName: string): string | null {
  const parsed = parsePrefixedMcpToolName(toolName);
  if (!parsed || !isServerKey(parsed.serverKeyPart)) {
    return null;
  }

  return `mcp_${parsed.serverKeyPart.slice(parsed.serverKeyPart.indexOf('::') + 2)}_${parsed.toolName}`;
}

export function resolveToolAlias(toolName: string, availableToolNames: Set<string>): string | null {
  if (availableToolNames.has(toolName)) {
    return toolName;
  }

  const parsed = parsePrefixedMcpToolName(toolName);
  if (!parsed) {
    return null;
  }

  const candidates = new Set<string>();
  if (isServerKey(parsed.serverKeyPart)) {
    candidates.add(`mcp_${parsed.serverKeyPart}_${parsed.toolName}`);
  } else {
    candidates.add(`mcp_toml::${parsed.serverKeyPart}_${parsed.toolName}`);
    candidates.add(`mcp_sqlite::${parsed.serverKeyPart}_${parsed.toolName}`);
  }

  for (const candidate of candidates) {
    if (availableToolNames.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function hasLegacyMcpAlias(toolName: string, allowedTools: Set<string>): boolean {
  const legacy = toLegacyMcpToolName(toolName);
  return legacy ? allowedTools.has(legacy) : false;
}
