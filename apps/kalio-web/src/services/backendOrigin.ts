const FRONTEND_BACKEND_PORT_PAIRS = new Map<string, string>([
  ['5188', '3016'],
  ['5288', '3316'],
  ['6188', '4016'],
]);

function canonicalLocalHostname(hostname: string): string {
  return hostname === 'localhost' || hostname === '127.0.0.1' ? '127.0.0.1' : hostname;
}

export function resolvePairedBackendOrigin(location: Location | undefined): string | null {
  if (!location) {
    return null;
  }

  const backendPort = FRONTEND_BACKEND_PORT_PAIRS.get(location.port);
  return backendPort ? `${location.protocol}//${canonicalLocalHostname(location.hostname)}:${backendPort}` : null;
}
