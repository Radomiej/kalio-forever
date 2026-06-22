import { describe, expect, it } from 'vitest';
import { resolvePairedBackendOrigin } from './backendOrigin';

function locationFor(port: string, hostname = '127.0.0.1'): Location {
  return {
    hostname,
    port,
    protocol: 'http:',
  } as Location;
}

describe('backendOrigin', () => {
  it('maps official frontend ports to their backend ports', () => {
    expect(resolvePairedBackendOrigin(locationFor('5188'))).toBe('http://127.0.0.1:3016');
    expect(resolvePairedBackendOrigin(locationFor('5288'))).toBe('http://127.0.0.1:3316');
    expect(resolvePairedBackendOrigin(locationFor('6188'))).toBe('http://127.0.0.1:4016');
  });

  it('returns null for random-port stacks so build-time env can drive them', () => {
    expect(resolvePairedBackendOrigin(locationFor('54231'))).toBeNull();
  });

  it('canonicalizes localhost frontend origins to IPv4 loopback backend origins', () => {
    expect(resolvePairedBackendOrigin(locationFor('5188', 'localhost'))).toBe('http://127.0.0.1:3016');
  });
});
