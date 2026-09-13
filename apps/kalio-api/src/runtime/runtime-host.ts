const PACKAGED_PROFILES = new Set(['runtime', 'desktop']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);

export function resolveRuntimeHost(env: NodeJS.ProcessEnv = process.env): string {
  const profile = env['KALIO_INSTALL_PROFILE']?.trim().toLowerCase();
  const requestedHost = env['KALIO_HOST']?.trim();

  if (!PACKAGED_PROFILES.has(profile ?? '')) {
    return requestedHost || '0.0.0.0';
  }

  if (requestedHost && !LOOPBACK_HOSTS.has(requestedHost)) {
    throw new Error(
      `Packaged Kalio runtime must bind to loopback; received KALIO_HOST=${requestedHost}`,
    );
  }

  return requestedHost || '127.0.0.1';
}

export function isEmbeddedUiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['KALIO_SERVE_UI'] === 'true';
}
