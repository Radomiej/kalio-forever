import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRetrieval, main } from './bench-embedding-retrieval.mjs';
test('known ranks produce exact Recall@5 and MRR', () => {
  const docs = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(evaluateRetrieval([[1, 0], [0, 1]], [[1, 0]], docs, [{ relevantIds: ['a'] }]), { recallAt5: 1, mrr: 1, dimensions: 2 });
  assert.equal(evaluateRetrieval([[1, 0], [0, 1]], [[1, 0]], docs, [{ relevantIds: ['b'] }]).mrr, .5);
});
test('malformed vectors and unknown relevance fail closed', () => {
  assert.throws(() => evaluateRetrieval([[NaN]], [[1]], [{ id: 'a' }], [{ relevantIds: ['a'] }]));
  assert.throws(() => evaluateRetrieval([[1]], [[1]], [{ id: 'a' }], [{ relevantIds: ['missing'] }]));
});
test('cloud endpoint is rejected before dataset reading or outbound requests', async () => {
  await assert.rejects(main(['missing.json', 'model', 'https://example.com']), /LOCAL_ENDPOINT_REQUIRED/);
});
