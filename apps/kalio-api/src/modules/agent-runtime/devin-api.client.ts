import { Injectable } from '@nestjs/common';

const DEFAULT_BASE_URL = 'https://api.devin.ai';
const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;

export interface DevinSession {
  sessionId: string;
  status: DevinSessionStatus;
  statusDetail?: DevinSessionStatusDetail;
  url?: string;
}

export type DevinSessionStatus = 'new' | 'claimed' | 'running' | 'exit' | 'error' | 'suspended' | 'resuming';
export type DevinSessionStatusDetail =
  | 'working'
  | 'waiting_for_user'
  | 'waiting_for_approval'
  | 'finished'
  | 'inactivity'
  | 'user_request'
  | 'usage_limit_exceeded'
  | 'out_of_credits'
  | 'out_of_quota'
  | 'no_quota_allocation'
  | 'payment_declined'
  | 'org_usage_limit_exceeded'
  | 'user_usage_limit_exceeded'
  | 'total_session_limit_exceeded'
  | 'error';

export interface DevinSessionMessage {
  eventId: string;
  message: string;
  source: string;
  createdAt?: number;
}

export interface DevinIntegrationStatus {
  configured: boolean;
  organizationId?: string;
  maxAcuLimit?: number;
}

export interface DevinApiClientPort {
  getIntegrationStatus(): DevinIntegrationStatus;
  getPollOptions(): { intervalMs: number; timeoutMs: number };
  createSession(prompt: string): Promise<DevinSession>;
  sendMessage(sessionId: string, message: string): Promise<DevinSession>;
  getSession(sessionId: string): Promise<DevinSession>;
  listMessages(sessionId: string, cursor?: string): Promise<{ items: DevinSessionMessage[]; endCursor?: string; hasNextPage: boolean }>;
}

export class DevinApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'DevinApiError';
  }
}

@Injectable()
export class DevinApiClient implements DevinApiClientPort {
  getIntegrationStatus(): DevinIntegrationStatus {
    const apiKey = process.env['DEVIN_API_KEY']?.trim();
    const organizationId = process.env['DEVIN_ORG_ID']?.trim();
    const maxAcuLimit = readPositiveInteger(process.env['DEVIN_MAX_ACU_LIMIT']);
    return {
      configured: Boolean(apiKey && organizationId && maxAcuLimit),
      ...(organizationId ? { organizationId: maskOrganizationId(organizationId) } : {}),
      ...(maxAcuLimit ? { maxAcuLimit } : {}),
    };
  }

  getPollOptions(): { intervalMs: number; timeoutMs: number } {
    return {
      intervalMs: readNonNegativeInteger(process.env['DEVIN_POLL_INTERVAL_MS']) ?? DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: readPositiveInteger(process.env['DEVIN_POLL_TIMEOUT_MS']) ?? DEFAULT_POLL_TIMEOUT_MS,
    };
  }

  async createSession(prompt: string): Promise<DevinSession> {
    const config = this.requireConfiguration();
    return this.request<unknown>(`/v3/organizations/${encodeURIComponent(config.organizationId)}/sessions`, {
      method: 'POST',
      body: {
        prompt,
        bypass_approval: false,
        max_acu_limit: config.maxAcuLimit,
      },
    }).then(parseSession);
  }

  async sendMessage(sessionId: string, message: string): Promise<DevinSession> {
    const config = this.requireConfiguration();
    return this.request<unknown>(
      `/v3/organizations/${encodeURIComponent(config.organizationId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: 'POST', body: { message } },
    ).then(parseSession);
  }

  async getSession(sessionId: string): Promise<DevinSession> {
    const config = this.requireConfiguration();
    return this.request<unknown>(
      `/v3/organizations/${encodeURIComponent(config.organizationId)}/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'GET' },
    ).then(parseSession);
  }

  async listMessages(
    sessionId: string,
    cursor?: string,
  ): Promise<{ items: DevinSessionMessage[]; endCursor?: string; hasNextPage: boolean }> {
    const config = this.requireConfiguration();
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const response = await this.request<unknown>(
      `/v3/organizations/${encodeURIComponent(config.organizationId)}/sessions/${encodeURIComponent(sessionId)}/messages${query}`,
      { method: 'GET' },
    );
    if (!isRecord(response)) throw new Error('Devin returned an invalid message page.');
    const items = Array.isArray(response['items']) ? response['items'].map(parseMessage).filter((item): item is DevinSessionMessage => item !== null) : [];
    return {
      items,
      ...(typeof response['end_cursor'] === 'string' ? { endCursor: response['end_cursor'] } : {}),
      hasNextPage: response['has_next_page'] === true,
    };
  }

  private requireConfiguration(): { apiKey: string; organizationId: string; maxAcuLimit: number } {
    const apiKey = process.env['DEVIN_API_KEY']?.trim();
    const organizationId = process.env['DEVIN_ORG_ID']?.trim();
    const maxAcuLimit = readPositiveInteger(process.env['DEVIN_MAX_ACU_LIMIT']);
    if (!apiKey || !organizationId || !maxAcuLimit) {
      throw new Error('Devin Cloud integration is not configured. Set DEVIN_API_KEY, DEVIN_ORG_ID, and a positive DEVIN_MAX_ACU_LIMIT.');
    }
    return { apiKey, organizationId, maxAcuLimit };
  }

  private async request<T>(path: string, init: { method: 'GET' | 'POST'; body?: Record<string, unknown> }): Promise<T> {
    const config = this.requireConfiguration();
    const baseUrl = process.env['NODE_ENV'] === 'test' ? process.env['DEVIN_API_BASE_URL']?.trim() || DEFAULT_BASE_URL : DEFAULT_BASE_URL;
    const response = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const raw = await response.text();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      const detail = isRecord(body) && typeof body['detail'] === 'string' ? body['detail'] : `Devin API request failed (${response.status}).`;
      throw new DevinApiError(response.status, sanitizeMessage(detail, config.apiKey));
    }
    return body as T;
  }
}

function parseSession(value: unknown): DevinSession {
  if (!isRecord(value) || typeof value['session_id'] !== 'string' || !isSessionStatus(value['status'])) {
    throw new Error('Devin returned an invalid session response.');
  }
  return {
    sessionId: value['session_id'],
    status: value['status'],
    ...(isSessionStatusDetail(value['status_detail']) ? { statusDetail: value['status_detail'] } : {}),
    ...(typeof value['url'] === 'string' ? { url: value['url'] } : {}),
  };
}

function parseMessage(value: unknown): DevinSessionMessage | null {
  if (!isRecord(value) || typeof value['event_id'] !== 'string' || typeof value['message'] !== 'string' || typeof value['source'] !== 'string') return null;
  return {
    eventId: value['event_id'],
    message: value['message'],
    source: value['source'],
    ...(typeof value['created_at'] === 'number' ? { createdAt: value['created_at'] } : {}),
  };
}

function isSessionStatus(value: unknown): value is DevinSessionStatus {
  return value === 'new' || value === 'claimed' || value === 'running' || value === 'exit' || value === 'error' || value === 'suspended' || value === 'resuming';
}

function isSessionStatusDetail(value: unknown): value is DevinSessionStatusDetail {
  return typeof value === 'string' && new Set<DevinSessionStatusDetail>([
    'working', 'waiting_for_user', 'waiting_for_approval', 'finished', 'inactivity', 'user_request', 'usage_limit_exceeded',
    'out_of_credits', 'out_of_quota', 'no_quota_allocation', 'payment_declined', 'org_usage_limit_exceeded', 'user_usage_limit_exceeded',
    'total_session_limit_exceeded', 'error',
  ]).has(value as DevinSessionStatusDetail);
}

function readPositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readNonNegativeInteger(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function maskOrganizationId(value: string): string {
  return value.length <= 8 ? '***' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function sanitizeMessage(message: string, secret: string): string {
  return message.replaceAll(secret, '[REDACTED]');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
