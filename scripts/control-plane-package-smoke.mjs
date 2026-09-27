import { networkInterfaces } from 'node:os';

export async function assertControlPlaneAuthentication(apiOrigin, token, allowedOrigins) {
  const protectedEndpoints = [
    '/api/allowed-paths',
    '/api/architecture-registry/schemas',
    '/api/architecture-runs/unassigned',
    '/api/credentials',
    '/api/llm/config',
    '/api/mcp/servers',
    '/api/mcp/tools',
    '/api/sessions',
    '/api/tools',
  ];
  for (const path of protectedEndpoints) {
    const anonymousResponse = await fetch(`${apiOrigin}${path}`, { signal: AbortSignal.timeout(2_000) });
    if (anonymousResponse.status !== 401) {
      throw new Error(`anonymous control-plane request ${path} returned HTTP ${anonymousResponse.status}`);
    }
  }

  const endpoint = `${apiOrigin}/api/allowed-paths`;
  const authorizedResponse = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(2_000),
  });
  if (!authorizedResponse.ok) {
    throw new Error(`authorized control-plane request returned HTTP ${authorizedResponse.status}`);
  }

  for (const origin of allowedOrigins) {
    const response = await fetch(endpoint, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
      signal: AbortSignal.timeout(2_000),
    });
    if (response.headers.get('access-control-allow-origin') !== origin
      || response.headers.get('access-control-allow-credentials') !== 'true'
      || !response.headers.get('access-control-allow-headers')?.toLowerCase().includes('authorization')) {
      throw new Error(`CORS preflight from ${origin} did not allow authenticated requests`);
    }
  }

  const rejectedOrigin = await fetch(endpoint, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.example',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    },
    signal: AbortSignal.timeout(2_000),
  });
  if (rejectedOrigin.headers.has('access-control-allow-origin')) {
    throw new Error('CORS preflight unexpectedly allowed an untrusted origin');
  }
}

export async function assertLoopbackOnly(port) {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => (entry.family === 'IPv4' || entry.family === 4)
      && !entry.internal && !entry.address.startsWith('169.254.'))
    .map((entry) => entry.address);

  for (const address of new Set(addresses)) {
    try {
      const response = await fetch(`http://${address}:${port}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        throw new Error(`packaged backend is reachable on non-loopback interface ${address}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('non-loopback interface')) throw error;
    }
  }
}
