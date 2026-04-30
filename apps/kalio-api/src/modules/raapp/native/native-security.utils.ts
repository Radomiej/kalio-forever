import os from 'node:os';
import path from 'node:path';

/**
 * Blocks RFC-1918, loopback, link-local (169.254.x.x/AWS metadata),
 * IPv6 loopback, and malformed URLs.
 * Returns true when the URL is private/internal (i.e. should be blocked).
 */
export function isPrivateUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);

    // Only allow http and https — block javascript:, file:, data:, etc.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;

    const hostname = url.hostname.toLowerCase();

    // IPv6 loopback / unspecified
    if (hostname === '::1' || hostname === '[::]' || hostname === '[::1]') return true;

    // Resolve bare "localhost" and keyword hostnames
    if (hostname === 'localhost' || hostname === '0.0.0.0') return true;

    // Strip IPv6 brackets for range checks
    const host = hostname.replace(/^\[|\]$/g, '');

    // Check IPv4 private / link-local ranges
    const ipv4 = parseIPv4(host);
    if (ipv4) {
      const [a, b, c] = ipv4;
      if (a === 127) return true;                          // 127.0.0.0/8 loopback
      if (a === 10) return true;                           // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
      if (a === 192 && b === 168) return true;             // 192.168.0.0/16
      if (a === 169 && b === 254) return true;             // 169.254.0.0/16 link-local / AWS metadata
      if (a === 0) return true;                            // 0.x.x.x
    }

    return false;
  } catch {
    // Malformed URL — block by default
    return true;
  }
}

/**
 * Resolves the path and allows only paths starting with the user's home
 * directory or the current working directory.
 * Returns true when the path is allowed.
 */
export function isAllowedFilePath(filePath: string): boolean {
  try {
    const resolved = path.resolve(filePath);
    const home = os.homedir();
    const cwd = process.cwd();
    return resolved.startsWith(home) || resolved.startsWith(cwd);
  } catch {
    return false;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}
