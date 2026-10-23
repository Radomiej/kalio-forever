import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function evaluateRetrieval(vectors, queryVectors, documents, queries) {
  const dimensions = vectors[0]?.length;
  if (!dimensions || vectors.length !== documents.length || queryVectors.length !== queries.length
    || [...vectors, ...queryVectors].some(v => !Array.isArray(v) || v.length !== dimensions || v.some(n => !Number.isFinite(n)))) throw new Error('INVALID_VECTORS');
  const cosine = (a, b) => {
    const norm = Math.hypot(...a) * Math.hypot(...b);
    if (!norm) throw new Error('ZERO_VECTOR');
    return a.reduce((sum, n, i) => sum + n * b[i], 0) / norm;
  };
  let recall = 0; let reciprocal = 0;
  queries.forEach((query, i) => {
    const relevant = new Set(query.relevantIds);
    if (!relevant.size || [...relevant].some(id => !documents.some(doc => doc.id === id))) throw new Error('INVALID_RELEVANCE');
    const ranked = documents.map((doc, j) => ({ id: doc.id, score: cosine(queryVectors[i], vectors[j]) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    recall += ranked.slice(0, 5).filter(doc => relevant.has(doc.id)).length / relevant.size;
    const first = ranked.findIndex(doc => relevant.has(doc.id));
    reciprocal += first < 0 ? 0 : 1 / (first + 1);
  });
  if (!queries.length) throw new Error('EMPTY_QUERIES');
  return { recallAt5: recall / queries.length, mrr: reciprocal / queries.length, dimensions };
}

export async function main(args = process.argv.slice(2)) {
  const [datasetPath, model, endpoint = 'http://127.0.0.1:11434'] = args;
  if (!datasetPath || !model) throw new Error('Usage: node scripts/bench-embedding-retrieval.mjs DATASET.json MODEL [LOCAL_OLLAMA_URL]');
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('LOCAL_ENDPOINT_REQUIRED');
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  const { documents, queries } = dataset;
  if (!Array.isArray(documents) || !documents.length || documents.length > 500 || !Array.isArray(queries) || !queries.length || queries.length > 100
    || documents.some(doc => typeof doc.id !== 'string' || typeof doc.text !== 'string' || doc.text.length > 20000)
    || new Set(documents.map(doc => doc.id)).size !== documents.length
    || queries.some(query => typeof query.text !== 'string' || query.text.length > 4096 || !Array.isArray(query.relevantIds))) throw new Error('INVALID_DATASET');
  const gemma = /^(?:[^/]+\/)?embeddinggemma-?2(?:$|[:@-])/i.test(model);
  const timings = [];
  async function embed(texts, purpose) {
    const result = []; const prefix = purpose === 'document' ? 'title: none | text: ' : 'task: search result | query: ';
    for (let i = 0; i < texts.length; i += 16) {
      const start = performance.now();
      const response = await fetch(`${url.origin}${url.pathname.replace(/\/$/, '')}/api/embed`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ model, input: texts.slice(i, i + 16).map(text => gemma ? prefix + text : text), truncate: false }),
      });
      if (!response.ok) throw new Error(`OLLAMA_HTTP_${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.slice(i, i + 16).length) throw new Error('INVALID_BATCH');
      result.push(...data.embeddings); timings.push(performance.now() - start);
    }
    return result;
  }
  const vectors = await embed(documents.map(doc => doc.text), 'document');
  const queryVectors = await embed(queries.map(query => query.text), 'query');
  const ordered = timings.toSorted((a, b) => a - b);
  console.log(JSON.stringify({ model, documents: documents.length, queries: queries.length, ...evaluateRetrieval(vectors, queryVectors, documents, queries),
    batchLatencyMedianMs: ordered[Math.floor(ordered.length / 2)], batchLatencyP95Ms: ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * .95))],
    boundary: 'Local Ollama dataset; not Kalio production or native multimodal proof' }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
