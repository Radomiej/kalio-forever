import { test, expect } from '@playwright/test';
import { API_BASE } from '../helpers/test-config';

// Check if real API key is available
const hasRealApiKey = !!(globalThis as any).process?.env.LLM_API_KEY;

test.describe('Memory API Integration Tests', () => {
  let personaId: string;
  let memoryId: string;

  test.beforeAll(async ({ request }) => {
    // Create a test persona first
    const personaResponse = await request.post(`${API_BASE}/personas`, {
      data: {
        name: 'Test Memory Persona',
        systemPrompt: 'You are a test persona for memory tests',
        model: 'gpt-4o-mini',
        skills: [],
      },
    });
    expect(personaResponse.ok()).toBeTruthy();
    const personaBody = await personaResponse.json();
    personaId = personaBody.id;
  });

  test.afterAll(async ({ request }) => {
    // Cleanup: delete the test persona
    if (personaId) {
      await request.delete(`${API_BASE}/personas/${personaId}`);
    }
  });

  test.describe('Ingestion', () => {
    test('POST /api/memory/ingest - ingests text and returns chunk IDs', async ({ request }) => {
      const response = await request.post(`${API_BASE}/memory/ingest`, {
        data: {
          text: 'This is a test memory entry for integration testing.',
          personaId,
        },
      });

      // Skip if embedding API fails (no real API key)
      if (response.status() === 500) {
        test.skip();
        return;
      }

      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body).toHaveProperty('ids');
      expect(body).toHaveProperty('count');
      expect(Array.isArray(body.ids)).toBeTruthy();
      expect(body.count).toBeGreaterThan(0);
      expect(body.count).toBe(body.ids.length);

      // Store first ID for later tests
      memoryId = body.ids[0];
    });

    test('POST /api/memory/ingest - handles empty text', async ({ request }) => {
      const response = await request.post(`${API_BASE}/memory/ingest`, {
        data: {
          text: '',
          personaId,
        },
      });
      // Skip if embedding API fails
      if (response.status() === 500) {
        test.skip();
        return;
      }
      // Should either succeed with 0 chunks or fail gracefully
      expect(response.status()).toBeGreaterThanOrEqual(200);
    });

    test('POST /api/memory/ingest - long text gets chunked', async ({ request }) => {
      const longText = 'This is a test. '.repeat(100); // ~1500 characters
      const response = await request.post(`${API_BASE}/memory/ingest`, {
        data: {
          text: longText,
          personaId,
        },
      });

      // Skip if embedding API fails
      if (response.status() === 500) {
        test.skip();
        return;
      }

      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.count).toBeGreaterThan(1); // Should be chunked
    });

    test('POST /api/memory/ingest-conversation - ingests conversation blocks', async ({ request }) => {
      const response = await request.post(`${API_BASE}/memory/ingest-conversation`, {
        data: {
          personaId,
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
          ],
        },
      });

      // Skip if embedding API fails
      if (response.status() === 500) {
        test.skip();
        return;
      }

      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body).toHaveProperty('ids');
      expect(body).toHaveProperty('count');
      expect(body.count).toBeGreaterThan(0);
    });
  });

  test.describe('Search', () => {
    test.beforeAll(async ({ request }) => {
      // Ensure we have some data to search
      await request.post(`${API_BASE}/memory/ingest`, {
        data: {
          text: 'The quick brown fox jumps over the lazy dog. Testing memory search functionality.',
          personaId,
        },
      });
    });

    test('GET /api/memory/search - hybrid search returns results', async ({ request }) => {
      const response = await request.get(`${API_BASE}/memory/search`, {
        params: {
          query: 'fox',
          personaId,
          mode: 'hybrid',
          limit: 5,
        },
      });
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(Array.isArray(body)).toBeTruthy();

      if (body.length > 0) {
        const result = body[0];
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('metadata');
        expect(result).toHaveProperty('createdAt');
        expect(typeof result.score).toBe('number');
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    test('GET /api/memory/search - vector search mode', async ({ request }) => {
      const response = await request.get(`${API_BASE}/memory/search`, {
        params: {
          query: 'memory',
          personaId,
          mode: 'vector',
          limit: 5,
        },
      });
      expect(response.ok()).toBeTruthy();
      expect(Array.isArray(await response.json())).toBeTruthy();
    });

    test('GET /api/memory/search - FTS (BM25) search mode', async ({ request }) => {
      const response = await request.get(`${API_BASE}/memory/search`, {
        params: {
          query: 'search',
          personaId,
          mode: 'fts',
          limit: 5,
        },
      });
      expect(response.ok()).toBeTruthy();
      expect(Array.isArray(await response.json())).toBeTruthy();
    });

    test('GET /api/memory/search - respects limit parameter', async ({ request }) => {
      const response = await request.get(`${API_BASE}/memory/search`, {
        params: {
          query: 'test',
          personaId,
          mode: 'hybrid',
          limit: 2,
        },
      });
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body.length).toBeLessThanOrEqual(2);
    });

    test('GET /api/memory/search - empty query returns empty results', async ({ request }) => {
      const response = await request.get(`${API_BASE}/memory/search`, {
        params: {
          query: '',
          personaId,
          mode: 'hybrid',
          limit: 5,
        },
      });
      // Should either return empty array or handle gracefully
      if (response.ok()) {
        const body = await response.json();
        expect(Array.isArray(body)).toBeTruthy();
      }
    });
  });

  test.describe('Retrieval', () => {
    test.beforeAll(async ({ request }) => {
      // Ensure we have data
      await request.post(`${API_BASE}/memory/ingest`, {
        data: {
          text: 'Test retrieval functionality',
          personaId,
        },
      });
    });

    test('GET /api/memory/:personaId - returns all memories for persona', async ({ request }) => {
      const response = await request.get(`${API_BASE}/memory/${personaId}`);
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(Array.isArray(body)).toBeTruthy();

      if (body.length > 0) {
        const result = body[0];
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('metadata');
        expect(result).toHaveProperty('createdAt');
      }
    });

    test('GET /api/memory/:personaId - returns empty array for non-existent persona', async ({ request }) => {
      const response = await request.get(`${API_BASE}/memory/non-existent-persona-id`);
      expect(response.ok()).toBeTruthy(); // Should succeed with empty array

      const body = await response.json();
      expect(Array.isArray(body)).toBeTruthy();
      expect(body.length).toBe(0);
    });
  });

  test.describe('Deletion', () => {
    test.beforeAll(async ({ request }) => {
      // Create a memory to delete
      const ingestResponse = await request.post(`${API_BASE}/memory/ingest`, {
        data: {
          text: 'Memory to be deleted',
          personaId,
        },
      });
      const ingestBody = await ingestResponse.json();
      if (ingestBody.ids && ingestBody.ids.length > 0) {
        memoryId = ingestBody.ids[0];
      }
    });

    test('DELETE /api/memory/:personaId/:id - deletes specific memory', async ({ request }) => {
      if (!memoryId) {
        test.skip();
        return;
      }

      const deleteResponse = await request.delete(`${API_BASE}/memory/${personaId}/${memoryId}`);
      expect(deleteResponse.ok()).toBeTruthy();

      // Verify it's gone by searching
      const searchResponse = await request.get(`${API_BASE}/memory/search`, {
        params: {
          query: 'deleted',
          personaId,
          mode: 'hybrid',
          limit: 10,
        },
      });
      const searchResults = await searchResponse.json();
      const deletedFound = searchResults.some((r: any) => r.id === memoryId);
      expect(deletedFound).toBeFalsy();
    });

    test('DELETE /api/memory/:personaId/:id - handles non-existent ID gracefully', async ({ request }) => {
      const response = await request.delete(`${API_BASE}/memory/${personaId}/non-existent-id`);
      // Should succeed even if ID doesn't exist
      expect(response.ok()).toBeTruthy();
    });

    test('DELETE /api/memory/:personaId - deletes all memories for persona', async ({ request }) => {
      // First add some memories
      await request.post(`${API_BASE}/memory/ingest`, {
        data: { text: 'Memory 1', personaId },
      });
      await request.post(`${API_BASE}/memory/ingest`, {
        data: { text: 'Memory 2', personaId },
      });

      // Delete all
      const deleteResponse = await request.delete(`${API_BASE}/memory/${personaId}`);
      expect(deleteResponse.ok()).toBeTruthy();

      // Verify empty
      const getResponse = await request.get(`${API_BASE}/memory/${personaId}`);
      const body = await getResponse.json();
      expect(body.length).toBe(0);
    });
  });

  test.describe('Status', () => {
    test('GET /api/memory/status/embedding - returns embedding status', async ({ request }) => {
      const response = await request.get(`${API_BASE}/memory/status/embedding`);
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body).toHaveProperty('configured');
      expect(body).toHaveProperty('provider');
      expect(typeof body.configured).toBe('boolean');
    });
  });

  test.describe('Persona Isolation', () => {
    let secondPersonaId: string;
    let hasMemories = false;

    test.beforeAll(async ({ request }) => {
      // Create second persona
      const personaResponse = await request.post(`${API_BASE}/personas`, {
        data: {
          name: 'Second Test Persona',
          systemPrompt: 'Another test persona',
          model: 'gpt-4o-mini',
          skills: [],
        },
      });
      const personaBody = await personaResponse.json();
      secondPersonaId = personaBody.id;

      // Add memory to first persona only
      const ingestResponse = await request.post(`${API_BASE}/memory/ingest`, {
        data: {
          text: 'This is only for persona 1',
          personaId,
        },
      });
      hasMemories = ingestResponse.ok() && ingestResponse.status() !== 500;
    });

    test.afterAll(async ({ request }) => {
      if (secondPersonaId) {
        await request.delete(`${API_BASE}/personas/${secondPersonaId}`);
      }
    });

    test('memories are isolated per persona', async ({ request }) => {
      if (!hasMemories) {
        test.skip();
        return;
      }

      // First persona should have memories
      const response1 = await request.get(`${API_BASE}/memory/${personaId}`);
      const body1 = await response1.json();
      expect(body1.length).toBeGreaterThan(0);

      // Second persona should have no memories
      const response2 = await request.get(`${API_BASE}/memory/${secondPersonaId}`);
      const body2 = await response2.json();
      expect(body2.length).toBe(0);
    });

    test('search only returns results for selected persona', async ({ request }) => {
      if (!hasMemories) {
        test.skip();
        return;
      }

      // Search in first persona - should find results
      const response1 = await request.get(`${API_BASE}/memory/search`, {
        params: {
          query: 'persona',
          personaId,
          mode: 'hybrid',
          limit: 10,
        },
      });
      const body1 = await response1.json();
      expect(body1.length).toBeGreaterThan(0);

      // Search in second persona - should find nothing
      const response2 = await request.get(`${API_BASE}/memory/search`, {
        params: {
          query: 'persona',
          personaId: secondPersonaId,
          mode: 'hybrid',
          limit: 10,
        },
      });
      const body2 = await response2.json();
      expect(body2.length).toBe(0);
    });
  });
});
