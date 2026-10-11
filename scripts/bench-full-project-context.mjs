import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireApi = createRequire(path.join(ROOT, 'apps/kalio-api/package.json'));
const apiModule = (name) => requireApi(path.join(ROOT, 'apps/kalio-api/dist/modules/memory', name));
const { ProjectResourceIndexStore } = apiModule('project-resource-index.store.js');
const { chunkProjectResourceContent } = apiModule('project-resource-chunks.js');
const identity = apiModule('embedding-identity.js');
const localProviderModule = apiModule('local-transformers-embedding.provider.js');

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.cs', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.css', '.scss', '.html', '.sh', '.ps1', '.sql', '.vue', '.svelte']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.mdx', '.json', '.yaml', '.yml', '.toml', '.csv', '.xml']);
const BINARY_EXTENSIONS = new Map([
  ['.png', 'image'], ['.jpg', 'image'], ['.jpeg', 'image'], ['.gif', 'image'], ['.webp', 'image'], ['.svg', 'image'],
  ['.pdf', 'pdf'], ['.mp3', 'audio'], ['.wav', 'audio'], ['.flac', 'audio'], ['.ogg', 'audio'], ['.m4a', 'audio'],
  ['.mp4', 'video'], ['.webm', 'video'], ['.mov', 'video'],
]);
const EXCLUDED_DIRS = new Set(['.git', '.codex', '.kalio', '.vscode', '.agents', '.pnpm-store', '.npm-cache', '.turbo', '.tmp', 'node_modules', 'data', 'dist', 'build', 'out', 'coverage', 'cache', 'test-results', 'playwright-report', '.next', '.vite', '.codex-remote-attachments']);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_CHUNKS_PER_DATABASE = 10_000;
const TARGET_CHUNKS_PER_SHARD = 7_000;
const BATCH_SIZE = 16;
const OLLAMA_URL = 'http://127.0.0.1:11434';
const OLLAMA_MODEL = 'nomic-embed-text:latest';
const GEMMA_CACHE = path.join(os.tmpdir(), 'kalio-embeddinggemma2-270m-cpu');
const PROJECT_ID = 'kalio-forever-full-worktree-benchmark';
const BENCHMARK_SCRIPT = 'scripts/bench-full-project-context.mjs';
const QUALITY_BENCHMARK_SCRIPT = 'scripts/bench-project-context-answers.mjs';
let activeOutputDir;

const queries = [
  { query: 'Which API guard refuses Ollama project indexing because mutable model tags do not prove immutable inference?', target: 'apps/kalio-api/src/modules/memory/project-resource-index.service.ts', type: 'code' },
  { query: 'Where does project indexing compare the source snapshot again before publishing the SQLite index?', target: 'apps/kalio-api/src/modules/memory/project-resource-index.service.ts', type: 'code' },
  { query: 'How are TypeScript classes split into member-sized chunks while preserving source coverage?', target: 'apps/kalio-api/src/modules/memory/project-resource-chunks.ts', type: 'code' },
  { query: 'Where are text extraction limits set for project files, total bytes, depth and entry count?', target: 'apps/kalio-api/src/modules/vfs/project-resource-reader.service.ts', type: 'code' },
  { query: 'Which project VFS code blocks symlink traversal and paths escaping the registered root?', target: 'apps/kalio-api/src/modules/vfs/project-resource-reader.service.ts', type: 'code' },
  { query: 'Where does SQLite create a separate vector table for each resource modality and an FTS5 index?', target: 'apps/kalio-api/src/modules/memory/project-resource-index.store.ts', type: 'code' },
  { query: 'Which store publishes a full resource snapshot inside one transaction and preserves the old snapshot on failure?', target: 'apps/kalio-api/src/modules/memory/project-resource-index.store.ts', type: 'code' },
  { query: 'Where does the chunker define overlap and AST declaration ranges for JavaScript and TypeScript?', target: 'apps/kalio-api/src/modules/memory/project-resource-chunks.ts', type: 'code' },
  { query: 'Which provider pins EmbeddingGemma 2 to a Hugging Face revision and declares its output dimension?', target: 'apps/kalio-api/src/modules/memory/local-transformers-embedding.provider.ts', type: 'code' },
  { query: 'Where is Windows automatic local embedding deliberately routed to CPU instead of WebGPU?', target: 'apps/kalio-api/src/modules/memory/local-transformers-embedding.provider.ts', type: 'code' },
  { query: 'Which Transformers provider has an explicit WebGPU path and reports its active backend?', target: 'apps/kalio-api/src/modules/memory/local-transformers-embedding.provider.ts', type: 'code' },
  { query: 'Where are the official Gemma document, semantic-query, and code-query prefixes applied?', target: 'apps/kalio-api/src/modules/memory/embedding-identity.ts', type: 'code' },
  { query: 'Which embedding identity binds provider scope, backend, endpoint, model revision, dimensions and prompt versions?', target: 'apps/kalio-api/src/modules/memory/embedding-identity.ts', type: 'code' },
  { query: 'Where does the model identity service resolve the current Ollama model digest?', target: 'apps/kalio-api/src/modules/memory/embedding-model-identity.service.ts', type: 'code' },
  { query: 'Which service owns the opt-in setting for indexing project context?', target: 'apps/kalio-api/src/modules/memory/project-context-settings.service.ts', type: 'code' },
  { query: 'Where are the HTTP endpoints for refreshing and searching a project resource index?', target: 'apps/kalio-api/src/modules/memory/project-resource-index.controller.ts', type: 'code' },
  { query: 'Which settings component lets a user choose a local embedding model and project context?', target: 'apps/kalio-web/src/features/settings/LocalEmbeddingConfigCard.tsx', type: 'code' },
  { query: 'Where does the Ollama adapter POST embedding requests to its local API?', target: 'apps/kalio-api/src/modules/memory/embedding.providers.ts', type: 'code' },
  { query: 'Find the architecture decision documenting why binary assets are indexed as metadata rather than image or audio content.', target: 'docs/spec/embedding-spaces-and-project-resources.md', type: 'text' },
  { query: 'Find the project resource API and its bounded file-reading and explicit opt-in requirements.', target: 'docs/spec/embedding-spaces-and-project-resources.md', type: 'text' },
];

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function log(event, fields = {}) { process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`); }
function safePath(relative) {
  const parts = relative.split('/');
  if (parts.some(part => EXCLUDED_DIRS.has(part.toLowerCase()))) return false;
  if (parts.some(part => /^\.env(?:\.|$)/i.test(part)
    || /(?:^|[._-])(?:secret|credentials?|private[-_]?key|id_rsa|api[-_]?key|access[-_]?token|token)(?:[._-]|$)/i.test(part))) return false;
  return relative !== BENCHMARK_SCRIPT && relative !== QUALITY_BENCHMARK_SCRIPT;
}
function classify(relative) {
  const ext = path.posix.extname(relative).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return { type: 'code', representation: 'content' };
  if (TEXT_EXTENSIONS.has(ext)) return { type: 'text', representation: 'content' };
  const type = BINARY_EXTENSIONS.get(ext);
  return type ? { type, representation: 'metadata' } : undefined;
}
function readCorpus() {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean);
  const files = [];
  const skipped = { excludedPath: 0, unsupported: 0, missingOrLink: 0, oversized: 0, invalidUtf8: 0, empty: 0 };
  let totalBytes = 0;
  for (const rawPath of listed) {
    const relative = rawPath.replaceAll('\\', '/');
    if (!safePath(relative)) { skipped.excludedPath++; continue; }
    const classification = classify(relative);
    if (!classification) { skipped.unsupported++; continue; }
    const absolute = path.join(ROOT, ...relative.split('/'));
    let stat;
    try { stat = lstatSync(absolute); } catch { skipped.missingOrLink++; continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) { skipped.missingOrLink++; continue; }
    if (stat.size > MAX_FILE_BYTES) { skipped.oversized++; continue; }
    const bytes = readFileSync(absolute);
    if (bytes.byteLength !== stat.size) throw new Error(`SOURCE_CHANGED_DURING_SCAN:${relative}`);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('CORPUS_TOTAL_SIZE_LIMIT');
    const contentHash = sha(bytes);
    const entry = { path: relative, bytes: bytes.byteLength, contentHash, ...classification };
    if (classification.representation === 'content') {
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { skipped.invalidUtf8++; continue; }
      if (!content.trim()) { skipped.empty++; continue; }
      entry.chunks = chunkProjectResourceContent(relative, content).map(chunk => ({
        id: sha(JSON.stringify([relative, chunk.startOffset, contentHash])),
        path: relative, resourceType: classification.type, representation: 'content', content: chunk.content, contentHash,
      }));
    } else {
      const metadata = `${classification.type} asset: ${relative}, size ${bytes.byteLength} bytes. File metadata only; binary content was not embedded.`;
      entry.chunks = [];
      for (let offset = 0; offset < metadata.length; offset += 1800) {
        entry.chunks.push({ id: sha(JSON.stringify([relative, offset, contentHash])), path: relative,
          resourceType: classification.type, representation: 'metadata', content: metadata.slice(offset, offset + 2000), contentHash });
        if (offset + 2000 >= metadata.length) break;
      }
    }
    files.push(entry);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const fingerprint = sha(JSON.stringify(files.map(file => [file.path, file.contentHash])));
  return { files, skipped, totalBytes, fingerprint };
}
function summarizeCorpus(corpus) {
  const byType = {};
  for (const file of corpus.files) {
    const item = byType[file.type] ??= { files: 0, bytes: 0, chunks: 0 };
    item.files++; item.bytes += file.bytes; item.chunks += file.chunks.length;
  }
  return { files: corpus.files.length, bytes: corpus.totalBytes, chunks: corpus.files.reduce((sum, file) => sum + file.chunks.length, 0), fingerprint: corpus.fingerprint, byType, skipped: corpus.skipped };
}
function assertTargets(corpus) {
  const paths = new Set(corpus.files.map(file => file.path));
  const missing = [...new Set(queries.map(item => item.target))].filter(target => !paths.has(target));
  if (missing.length) throw new Error(`BENCHMARK_TARGETS_MISSING:${missing.join(',')}`);
}
function filesInDirectory(root) {
  let bytes = 0;
  if (!existsSync(root)) return 0;
  for (const name of readdirSync(root)) {
    const filename = path.join(root, name);
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink()) continue;
    bytes += stat.isDirectory() ? filesInDirectory(filename) : stat.size;
  }
  return bytes;
}
function makeSpace(provider, model, modelRevision, backend, baseUrl, dimensions, promptVersion, providerScope) {
  return identity.buildEmbeddingSpace({
    provider, providerScope, backend, model, modelRevision, dimensions, baseUrl, promptVersion,
    ...identity.embeddingPromptVersions(promptVersion),
  });
}
function indexRoot(outputDir, label) { return path.join(outputDir, label === 'gemma' ? 'g' : 'o'); }
function databasePath(root, projectId, spaceId) {
  const projectHash = sha(projectId);
  return path.join(root, 'project-resources', projectHash, `${sha(spaceId)}.db`);
}
function chunksFor(corpus) { return corpus.files.flatMap(file => file.chunks); }
function buildShards(corpus) {
  const shards = [];
  let current = [];
  let count = 0;
  for (const file of corpus.files) {
    if (file.chunks.length > MAX_CHUNKS_PER_DATABASE) throw new Error(`SINGLE_FILE_CHUNK_LIMIT:${file.path}:${file.chunks.length}`);
    if (count > 0 && count + file.chunks.length > TARGET_CHUNKS_PER_SHARD) {
      shards.push(current);
      current = [];
      count = 0;
    }
    current.push(...file.chunks);
    count += file.chunks.length;
  }
  if (current.length) shards.push(current);
  if (shards.some(shard => shard.length > MAX_CHUNKS_PER_DATABASE)) throw new Error('PROJECT_RESOURCE_CHUNK_LIMIT_PER_SHARD');
  return shards;
}
function verifyStorePath(root, projectId, space) {
  const dbPath = databasePath(root, projectId, space.id);
  const probe = new ProjectResourceIndexStore(root, projectId, space);
  try {
    probe.replace([{ id: '__store_path_probe__', path: '__benchmark_store_path_probe__', resourceType: 'text',
      representation: 'content', content: 'benchmark storage path preflight', contentHash: sha('benchmark storage path preflight'),
      embedding: Array(space.dimensions).fill(0.01) }], Date.now());
  } finally { probe.close(); }
  const reopened = new ProjectResourceIndexStore(root, projectId, space);
  try {
    if (reopened.status().indexedChunks !== 1 || !reopened.hasCurrentChunking()) throw new Error('SQLITE_STORE_PATH_PREFLIGHT_FAILED');
  } finally { reopened.close(); }
  return { databasePath: path.relative(ROOT, dbPath).replaceAll('\\', '/'), pathChars: dbPath.length, reopened: true };
}
function metrics(rows) {
  const count = rows.length;
  const hitsAt = k => rows.filter(row => row.rank !== null && row.rank <= k).length / count;
  return { hitAt1: hitsAt(1), recallAt5: hitsAt(5), mrrAt5: rows.reduce((sum, row) => sum + (row.rank === null ? 0 : 1 / row.rank), 0) / count };
}
function rankResults(results, target) {
  const index = results.findIndex(result => result.path === target);
  return index < 0 ? null : index + 1;
}
async function embedOllama(texts) {
  const response = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, input: texts, dimensions: 768, truncate: false, options: { num_gpu: 0 } }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`OLLAMA_EMBED_HTTP_${response.status}:${(await response.text()).slice(0, 500)}`);
  const result = await response.json();
  if (!Array.isArray(result.embeddings) || result.embeddings.length !== texts.length
    || result.embeddings.some(vector => !Array.isArray(vector) || vector.length !== 768 || vector.some(value => !Number.isFinite(value)))) {
    throw new Error('OLLAMA_EMBED_SHAPE_INVALID');
  }
  return result.embeddings;
}
async function getOllamaModel() {
  const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`OLLAMA_TAGS_HTTP_${response.status}`);
  const tags = await response.json();
  const model = tags.models?.find(item => item.name === OLLAMA_MODEL);
  if (!model?.digest || !Number.isSafeInteger(model.size)) throw new Error(`OLLAMA_MODEL_NOT_INSTALLED:${OLLAMA_MODEL}`);
  return { digest: model.digest, size: model.size, modifiedAt: model.modified_at };
}
async function embedBatches(embed, space, inputs, purpose, label) {
  const outputs = [];
  const timings = [];
  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const source = inputs.slice(start, start + BATCH_SIZE);
    const texts = identity.preparePinnedEmbeddingTexts(space, source, purpose);
    const began = performance.now();
    const vectors = await embed(texts);
    const elapsedMs = performance.now() - began;
    if (vectors.length !== source.length || vectors.some(vector => vector.length !== space.dimensions)) throw new Error('EMBEDDING_BATCH_SHAPE_INVALID');
    outputs.push(...vectors);
    timings.push({ count: source.length, elapsedMs });
    if (timings.length === 1 || timings.length % 25 === 0 || start + source.length === inputs.length) {
      log('embedding-progress', { model: label, completed: start + source.length, total: inputs.length, batches: timings.length, batchElapsedMs: Math.round(elapsedMs) });
    }
  }
  return { vectors: outputs, timings };
}
function modelStore(corpus, vectors, root, space) {
  const sourceChunks = chunksFor(corpus);
  if (sourceChunks.length !== vectors.length) throw new Error('EMBEDDING_COUNT_MISMATCH');
  const shards = buildShards(corpus);
  const records = [];
  let vectorOffset = 0;
  for (let shardIndex = 0; shardIndex < shards.length; shardIndex++) {
    const shard = shards[shardIndex];
    const shardName = `s${shardIndex + 1}`;
    const shardRoot = path.join(root, shardName);
    const shardProjectId = `${PROJECT_ID}-${shardName}`;
    const rows = shard.map(chunk => ({ ...chunk, embedding: vectors[vectorOffset++] }));
    const store = new ProjectResourceIndexStore(shardRoot, shardProjectId, space);
    try { store.replace(rows, Date.now()); }
    finally { store.close(); }
    const reopened = new ProjectResourceIndexStore(shardRoot, shardProjectId, space);
    try {
      const status = reopened.status();
      const refs = reopened.sourceReferences();
      const expectedRefs = new Set(shard.map(row => row.path)).size;
      if (status.indexedChunks !== rows.length || refs.length !== expectedRefs || !reopened.hasCurrentChunking()) {
        throw new Error(`PERSISTED_INDEX_REOPEN_VERIFICATION_FAILED:${shardName}`);
      }
      const dbPath = databasePath(shardRoot, shardProjectId, space.id);
      records.push({ shard: shardName, projectId: shardProjectId, databasePath: path.relative(ROOT, dbPath).replaceAll('\\', '/'),
        bytes: statSync(dbPath).size, sha256: sha(readFileSync(dbPath)), indexedChunks: status.indexedChunks,
        uniqueSources: refs.length, indexedAt: status.indexedAt, chunkingVersionCurrent: true });
    } finally { reopened.close(); }
  }
  if (vectorOffset !== vectors.length) throw new Error('PERSISTED_INDEX_VECTOR_PARTITION_MISMATCH');
  return records;
}
function mergeShardResults(shardResults, limit) {
  const ranked = new Map();
  for (const results of shardResults) {
    results.forEach((result, index) => {
      const previous = ranked.get(result.id);
      ranked.set(result.id, { result, score: (previous?.score ?? 0) + (result.score ?? 1 / (60 + index + 1)) });
    });
  }
  return [...ranked.values()].sort((a, b) => b.score - a.score || a.result.id.localeCompare(b.result.id))
    .slice(0, limit).map(item => item.result);
}
function searchShards(root, space, item, vector, mode, shards) {
  const results = [];
  const selectedTypes = item.type === 'code' ? ['code'] : item.type === 'text' ? ['text'] : [...BINARY_EXTENSIONS.values()];
  for (let shardIndex = 0; shardIndex < shards.length; shardIndex++) {
    const shardName = `s${shardIndex + 1}`;
    const store = new ProjectResourceIndexStore(path.join(root, shardName), `${PROJECT_ID}-${shardName}`, space);
    try { results.push(store.search(item.query, vector, selectedTypes, 5, mode)); }
    finally { store.close(); }
  }
  return mergeShardResults(results, 5);
}
async function evaluate(label, embed, space, root, corpus) {
  const started = performance.now();
  const sourceChunks = chunksFor(corpus);
  log('index-started', { model: label, chunks: sourceChunks.length, projectFiles: corpus.files.length, batchSize: BATCH_SIZE });
  const indexed = await embedBatches(embed, space, sourceChunks.map(chunk => chunk.content), 'document', label);
  const embedMs = performance.now() - started;
  const refsBeforePublish = readCorpus();
  if (refsBeforePublish.fingerprint !== corpus.fingerprint) throw new Error('CORPUS_CHANGED_DURING_INDEXING');
  const persisted = modelStore(corpus, indexed.vectors, root, space);
  const shardFiles = buildShards(corpus);
  const totalDbBytes = persisted.reduce((sum, shard) => sum + shard.bytes, 0);
  const results = [];
  const queryTimes = [];
  for (const item of queries) {
    const purpose = item.type === 'code' ? 'code_query' : 'query';
    const queryStarted = performance.now();
    const queryVectors = await embed(identity.preparePinnedEmbeddingTexts(space, [item.query], purpose));
    queryTimes.push(performance.now() - queryStarted);
    const vector = searchShards(root, space, item, queryVectors[0], 'vector', shardFiles);
    const hybrid = searchShards(root, space, item, queryVectors[0], 'hybrid', shardFiles);
    results.push({ query: item.query, target: item.target, type: item.type,
      vectorRank: rankResults(vector, item.target), vectorTop5: vector.map(row => row.path),
      hybridRank: rankResults(hybrid, item.target), hybridTop5: hybrid.map(row => row.path) });
  }
  const batchMs = indexed.timings.map(item => item.elapsedMs);
  return {
    model: label, space, sourceIndex: { shards: persisted, databaseCount: persisted.length, bytes: totalDbBytes,
      bytesMiB: Number((totalDbBytes / 1024 / 1024).toFixed(2)), indexedChunks: persisted.reduce((sum, shard) => sum + shard.indexedChunks, 0),
      uniqueSources: new Set(corpus.files.map(file => file.path)).size, chunkingVersionCurrent: true,
      retrievalMerge: 'per-shard search followed by reciprocal-rank fusion; current application HTTP API does not merge these benchmark shards' },
    inference: { embeddedChunks: indexed.vectors.length, batchSize: BATCH_SIZE, elapsedMs: Math.round(embedMs),
      docsPerSecond: Number((indexed.vectors.length / (embedMs / 1000)).toFixed(2)), batchMedianMs: Math.round([...batchMs].sort((a, b) => a - b)[Math.floor(batchMs.length / 2)] ?? 0),
      batchP95Ms: Math.round([...batchMs].sort((a, b) => a - b)[Math.min(batchMs.length - 1, Math.ceil(batchMs.length * 0.95) - 1)] ?? 0),
      queryMedianMs: Math.round([...queryTimes].sort((a, b) => a - b)[Math.floor(queryTimes.length / 2)] ?? 0) },
    retrieval: { queryCount: results.length, vector: metrics(results.map(row => ({ rank: row.vectorRank }))), hybrid: metrics(results.map(row => ({ rank: row.hybridRank }))), results },
  };
}
function writeJson(filename, value) { writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

async function main() {
  const preflight = process.argv.includes('--preflight');
  const corpus = readCorpus();
  assertTargets(corpus);
  const summary = summarizeCorpus(corpus);
  const shards = buildShards(corpus);
  const sampleDbPath = databasePath(path.join(ROOT, 'data', 'b', '261011T000000-99999', 'g', 's1'), `${PROJECT_ID}-s1`, 'space');
  if (sampleDbPath.length >= 260) throw new Error(`SQLITE_PATH_TOO_LONG:${sampleDbPath.length}`);
  log('corpus-ready', { root: ROOT, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), ...summary,
    shardCount: shards.length, shardChunkCounts: shards.map(shard => shard.length), queryCount: queries.length,
    maxChunksPerDatabase: MAX_CHUNKS_PER_DATABASE, targetChunksPerShard: TARGET_CHUNKS_PER_SHARD, sqlitePathChars: sampleDbPath.length });
  if (preflight) return;
  if (!existsSync(GEMMA_CACHE)) throw new Error(`GEMMA_CACHE_MISSING:${GEMMA_CACHE}`);
  const ollama = await getOllamaModel();
  const localStamp = new Date().toISOString().slice(2, 19).replaceAll('-', '').replaceAll(':', '');
  const runId = `${localStamp}-${process.pid}`;
  const outputDir = path.join(ROOT, 'data', 'b', runId);
  if (existsSync(outputDir)) throw new Error(`OUTPUT_ALREADY_EXISTS:${outputDir}`);
  mkdirSync(outputDir, { recursive: true });
  activeOutputDir = outputDir;
  const manifest = { runId, measuredAt: new Date().toISOString(), root: ROOT,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), corpus: summary,
    files: corpus.files.map(({ path: filePath, bytes, contentHash, type, representation, chunks }) => ({ path: filePath, bytes, contentHash, type, representation, chunkCount: chunks.length })),
    querySet: queries, localOnly: true, note: 'Current worktree; git-listed nonignored files after explicit safe-path and size filters. Binary assets contribute metadata only.' };
  writeJson(path.join(outputDir, 'corpus-manifest.json'), manifest);
  const report = { runId, measuredAt: manifest.measuredAt, head: manifest.head, corpus: summary, queries: queries.length,
    models: [], modelFiles: { gemmaCacheBytes: filesInDirectory(GEMMA_CACHE), ollama: { ...ollama } },
    appIntegrationBoundary: 'This benchmark uses the app chunker and SQLite store in isolated data. Full corpus exceeds the single-database 10000-chunk cap, so it is sharded; current VFS limits and immutable-model identity checks still apply, and the app HTTP path does not merge these benchmark shards.' };
  writeJson(path.join(outputDir, 'report.json'), report);

  const gemmaSpace = makeSpace('local-transformers', localProviderModule.GEMMA2_LOCAL_EMBEDDING_MODEL,
    localProviderModule.GEMMA2_LOCAL_EMBEDDING_REVISION, 'webgpu', `local-cache:${GEMMA_CACHE}`,
    localProviderModule.GEMMA2_LOCAL_EMBEDDING_DIMENSIONS, identity.GEMMA2_EMBEDDING_PROMPT_VERSION,
    `bench-${sha(JSON.stringify(['hf-pinned-cache-v1', GEMMA_CACHE, 'webgpu']))}`);
  const ollamaSpace = makeSpace('ollama', OLLAMA_MODEL, ollama.digest, 'cpu', OLLAMA_URL,
    768, identity.RAW_EMBEDDING_PROMPT_VERSION,
    `bench-${sha(JSON.stringify([OLLAMA_URL, ollama.digest, 'num_gpu=0']))}`);
  report.storagePreflight = {
    gemma: verifyStorePath(path.join(indexRoot(outputDir, 'gemma'), 's1'), `${PROJECT_ID}-s1`, gemmaSpace),
    ollama: verifyStorePath(path.join(indexRoot(outputDir, 'ollama'), 's1'), `${PROJECT_ID}-s1`, ollamaSpace),
  };
  writeJson(path.join(outputDir, 'report.json'), report);
  const gemma = new localProviderModule.LocalTransformersEmbeddingProvider({ model: localProviderModule.GEMMA2_LOCAL_EMBEDDING_MODEL,
    dimensions: localProviderModule.GEMMA2_LOCAL_EMBEDDING_DIMENSIONS, cacheDir: GEMMA_CACHE, backend: 'webgpu', allowRemoteModels: false });
  try {
    const gemmaResult = await evaluate('EmbeddingGemma 2 270M q4 · WebGPU', texts => gemma.embed(texts), gemmaSpace,
      indexRoot(outputDir, 'gemma'), corpus);
    const activeBackend = gemma.getActiveBackend();
    if (activeBackend !== 'webgpu') throw new Error(`GEMMA_GPU_NOT_USED:${activeBackend}`);
    gemmaResult.inference.activeBackend = activeBackend;
    gemmaResult.inference.gpuAvailable = gemma.isGpuAvailable();
    gemmaResult.modelSizeBytes = filesInDirectory(GEMMA_CACHE);
    report.models.push(gemmaResult);
    writeJson(path.join(outputDir, 'report.json'), report);
    log('model-finished', { model: gemmaResult.model, ...gemmaResult.sourceIndex, retrieval: { vector: gemmaResult.retrieval.vector, hybrid: gemmaResult.retrieval.hybrid } });
  } finally { await gemma.dispose(); }

  const ollamaBefore = await getOllamaModel();
  if (ollamaBefore.digest !== ollama.digest) throw new Error('OLLAMA_MODEL_CHANGED_BEFORE_INDEX');
  const ollamaResult = await evaluate('Ollama Nomic Embed Text · forced CPU', embedOllama, ollamaSpace,
    indexRoot(outputDir, 'ollama'), corpus);
  const ollamaAfter = await getOllamaModel();
  if (ollamaAfter.digest !== ollama.digest) throw new Error('OLLAMA_MODEL_CHANGED_DURING_INDEX');
  ollamaResult.modelDigestAfter = ollamaAfter.digest;
  ollamaResult.modelSizeBytes = ollama.size;
  report.models.push(ollamaResult);
  const finalCorpus = readCorpus();
  if (finalCorpus.fingerprint !== corpus.fingerprint) throw new Error('CORPUS_CHANGED_BEFORE_FINAL_REPORT');
  report.completedAt = new Date().toISOString();
  report.finalCorpusFingerprintVerified = true;
  report.modelFiles.gemmaCacheBytes = filesInDirectory(GEMMA_CACHE);
  writeJson(path.join(outputDir, 'report.json'), report);
  writeJson(path.join(outputDir, 'summary.json'), { runId, completedAt: report.completedAt, corpus: summary,
    models: report.models.map(item => ({ model: item.model, spaceId: item.space.id, modelRevision: item.space.modelRevision,
      backend: item.space.backend, modelSizeBytes: item.modelSizeBytes, index: item.sourceIndex, inference: item.inference,
      retrieval: { queryCount: item.retrieval.queryCount, vector: item.retrieval.vector, hybrid: item.retrieval.hybrid } })) });
  log('benchmark-complete', { outputDir, models: report.models.length, corpusFingerprint: corpus.fingerprint });
}

main().catch(error => {
  if (activeOutputDir) {
    try { writeJson(path.join(activeOutputDir, 'failure.json'), { failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }); }
    catch (writeError) { log('failure-report-write-failed', { error: writeError instanceof Error ? writeError.message : String(writeError) }); }
  }
  log('benchmark-failed', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
  process.exitCode = 1;
});
