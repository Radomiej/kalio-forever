function withLoopbackAliases(origin: string): string[] {
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost') {
      const alias = new URL(origin);
      alias.hostname = '127.0.0.1';
      return [origin, alias.toString().replace(/\/$/, '')];
    }
    if (url.hostname === '127.0.0.1') {
      const alias = new URL(origin);
      alias.hostname = 'localhost';
      return [origin, alias.toString().replace(/\/$/, '')];
    }
  } catch {
    return [origin];
  }

  return [origin];
}

export function normalizeCorsOrigins(configuredOrigins: string | undefined): string[] | '*' {
  const rawOrigins = (configuredOrigins ?? '*')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (rawOrigins.length === 0 || rawOrigins.includes('*')) {
    return '*';
  }

  const normalized = new Set<string>();
  for (const origin of rawOrigins) {
    for (const alias of withLoopbackAliases(origin)) {
      normalized.add(alias.replace(/\/$/, ''));
    }
  }

  return [...normalized];
}
