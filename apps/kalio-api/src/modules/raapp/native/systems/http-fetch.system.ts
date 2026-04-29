import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { NativeSystemRegistry } from '../native-system-registry.service';
import { isPrivateUrl } from '../native-security.utils';

const MAX_RESPONSE_BYTES = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Registers the `http_fetch` native system.
 *
 * Security controls:
 * - SSRF blocked via isPrivateUrl() (RFC-1918, loopback, AWS metadata, malformed)
 * - redirect: 'manual' to block open-redirect SSRF chains
 * - Response body capped at 10 000 characters
 * - Optional `headers` map for auth tokens (no credential lookup yet — plain values only)
 */
@Injectable()
export class HttpFetchSystem implements OnModuleInit {
  private readonly logger = new Logger(HttpFetchSystem.name);

  constructor(private readonly registry: NativeSystemRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      id: 'http_fetch',
      description:
        'Perform an HTTP GET request to a public URL and return the response body as text. ' +
        'Private/internal URLs (RFC-1918, loopback, AWS metadata) are blocked. ' +
        'Response body is capped at 10 000 characters.',
      approval_required: false,
      input_schema: {
        url: { type: 'string', description: 'Target URL (must be publicly reachable)' },
        headers: { type: 'object', description: 'Optional HTTP headers to include (e.g. Authorization)' },
      },
      handler: async (args) => {
        const url = args['url'];
        if (typeof url !== 'string' || !url) {
          throw new Error('http_fetch: "url" argument is required and must be a string');
        }

        if (isPrivateUrl(url)) {
          throw new Error(`http_fetch: private/internal URLs are not allowed: ${url}`);
        }

        // Build headers — only string values allowed
        const rawHeaders = args['headers'];
        const headers: Record<string, string> = {};
        if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
          for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
            if (typeof v === 'string') headers[k] = v;
          }
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
          const response = await fetch(url, {
            method: 'GET',
            headers,
            redirect: 'manual',    // block open-redirect SSRF chains
            signal: controller.signal,
          });

          // Blocked redirect → manual means 3xx responses are returned as-is
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location') ?? '';
            if (location && isPrivateUrl(location)) {
              throw new Error(`http_fetch: redirect to private/internal URL blocked: ${location}`);
            }
          }

          const text = await response.text();
          this.logger.debug(`http_fetch: ${url} → ${response.status} (${text.length} chars)`);

          return {
            url,
            status: response.status,
            ok: response.ok,
            content: text.slice(0, MAX_RESPONSE_BYTES),
            truncated: text.length > MAX_RESPONSE_BYTES,
          };
        } finally {
          clearTimeout(timeout);
        }
      },
    });
  }
}
