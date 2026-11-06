import { describe, expect, it, vi } from 'vitest';
import { createLocalDecisionModelTransport, parseLocalDecisionCatalog } from './local-decision-model.transport';

const model = {
  modelTag: 'qwen3.5:2b-q4_K_M', displayName: 'Qwen 3.5 2B', expectedSizeBytes: 1945781358,
  installed: true, chatCompatible: true, readiness: 'metadata_ready', sizeBytes: 1945781358,
  digest: 'a'.repeat(64), capabilities: ['completion', 'vision'], installable: false,
};
const job = {
  jobId: '12345678-1234-1234-1234-123456789abc', requestId: 'request-a', modelTag: model.modelTag,
  revision: 1, state: 'installed', progress: { completedBytes: 0, observedTotalBytes: 0, currentBlob: null },
  error: null, cancelScope: 'request_only', createdAt: 1, updatedAt: 2,
};
const catalog = { version: 1, backendAvailable: true, backendError: null, models: [model], activeJob: null, recentJobs: [job] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('local decision model contract v1', () => {
  it('validates the curated catalogue without inferring readiness or selecting a model', () => {
    expect(parseLocalDecisionCatalog(catalog)).toEqual(catalog);
    const unknown = { ...model, chatCompatible: null, readiness: 'unknown' };
    expect(parseLocalDecisionCatalog({ ...catalog, models: [unknown] }).models[0].chatCompatible).toBeNull();
  });

  it.each([
    { ...catalog, version: 2 }, { ...catalog, models: [] }, { ...catalog, models: [model, model] },
    { ...catalog, recentJobs: Array.from({ length: 17 }, () => job) },
    { ...catalog, models: [{ ...model, modelTag: 'arbitrary:model' }] },
    { ...catalog, models: [{ ...model, expectedSizeBytes: 1900000000 }] },
    { ...catalog, models: [{ ...model, installed: false }] },
    { ...catalog, models: [{ ...model, chatCompatible: false }] },
    { ...catalog, activeJob: { ...job, progress: { completedBytes: 20, observedTotalBytes: 10, currentBlob: null } } },
    { ...catalog, activeJob: { ...job, cancelScope: 'daemon' } },
    { ...catalog, activeJob: { ...job, jobId: '../../other' } },
  ])('fails closed on invalid or contradictory response %#', (value) => {
    expect(() => parseLocalDecisionCatalog(value)).toThrow('Invalid local model response');
  });

  it('uses exact authenticated routes, retains request identity on explicit 401 replay, and never writes settings', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(catalog))
      .mockResolvedValueOnce(response({ code: 'DECISION_AUTH_REQUIRED' }, 401))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(response({ outcome: 'already_installed', model, job }))
      .mockResolvedValueOnce(response({ job })).mockResolvedValueOnce(response({ job }));
    const api = createLocalDecisionModelTransport(fetcher);
    expect(await api.catalog()).toEqual(catalog);
    expect((await api.install(model.modelTag, job.requestId)).outcome).toBe('already_installed');
    expect(await api.job(job.jobId)).toEqual(job);
    expect(await api.cancel(job.jobId)).toEqual(job);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/decision/ollama/models', '/api/decision/ollama/install', '/api/decision/auth',
      '/api/decision/ollama/install', `/api/decision/ollama/install/${job.jobId}`, `/api/decision/ollama/install/${job.jobId}/cancel`,
    ]);
    const body = JSON.stringify({ modelTag: model.modelTag, requestId: job.requestId });
    expect(fetcher.mock.calls[1][1]?.body).toBe(body);
    expect(fetcher.mock.calls[3][1]?.body).toBe(body);
    expect(fetcher.mock.calls[5][1]?.body).toBe('{}');
    for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
  });

  it('does not replay an ambiguous PUT and validates request identity before sending', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('Connection reset'));
    const api = createLocalDecisionModelTransport(fetcher);
    await expect(api.install(model.modelTag, 'stable-request')).rejects.toThrow('Connection reset');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(api.install('other:model', 'stable-request')).rejects.toThrow();
    await expect(api.install(model.modelTag, '../bad')).rejects.toThrow();
    await expect(api.job('../bad')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('accepts observed counter regression and unknown cancellation without inventing global completion', () => {
    const progress = { completedBytes: 10, observedTotalBytes: 100, currentBlob: { digest: 'a'.repeat(64), completedBytes: null, totalBytes: 100 } };
    const activeJob = { ...job, state: 'unknown', progress, error: { code: 'OLLAMA_CANCEL_UNCERTAIN', message: 'Cancellation is unconfirmed.' } };
    expect(parseLocalDecisionCatalog({ ...catalog, activeJob }).activeJob).toEqual(activeJob);
    expect(parseLocalDecisionCatalog({ ...catalog, activeJob: { ...activeJob, progress: { ...progress, completedBytes: 5 } } }).activeJob?.progress.completedBytes).toBe(5);
  });
});
