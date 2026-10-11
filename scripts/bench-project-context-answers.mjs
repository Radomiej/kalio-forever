import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ID = '261010T233453-50632';
const RUN_DIR = path.join(ROOT, 'data', 'b', RUN_ID);
const OUTPUT = path.join(RUN_DIR, 'detailed-chunking-answerability.json');
const OLLAMA_URL = 'http://127.0.0.1:11434';
const OLLAMA_MODEL = 'nomic-embed-text:latest';
const GEMMA_CACHE = path.join(os.tmpdir(), 'kalio-embeddinggemma2-270m-cpu');
const QUESTIONS = [
  { id: 'DEP-01', category: 'package.json', type: 'text', targets: ['package.json'], query: 'In the repository-root package.json, what exact packageManager value and Node.js/pnpm engine ranges are declared?', evidence: ['pnpm@9.15.0', '>=22.0.0', '>=9.0.0'] },
  { id: 'DEP-02', category: 'package.json', type: 'text', targets: ['apps/kalio-api/package.json'], query: 'Read apps/kalio-api/package.json and report exact declared ranges for NestJS, Drizzle ORM, better-sqlite3, sqlite-vec, and @huggingface/transformers.', evidence: ['@nestjs/core', '^11.1.19', 'drizzle-orm', '^0.45.2', 'better-sqlite3', '^12.9.0', 'sqlite-vec', '^0.1.9', '@huggingface/transformers', '^4.3.1'] },
  { id: 'DEP-03', category: 'package.json', type: 'text', targets: ['apps/kalio-web/package.json'], query: 'Read apps/kalio-web/package.json and give the declared versions of React, Zustand, Vite, and react-markdown.', evidence: ['react', '^19.0.0', 'zustand', '^5.0.3', 'vite', '^6.3.5', 'react-markdown', '^9.0.3'] },
  { id: 'DEP-04', category: 'package.json', type: 'text', targets: ['package.json'], query: 'In the root package.json, how do the build and typecheck scripts sequence @kalio/types, @kalio/sdk, kalio-api, and kalio-web?', evidence: ['corepack pnpm', '@kalio/types', '@kalio/sdk', 'kalio-api', 'kalio-web'] },
  { id: 'DEP-05', category: 'package.json', type: 'text', targets: ['apps/kalio-api/package.json'], query: 'In apps/kalio-api/package.json, which test runner command is used and which coverage runner is installed?', evidence: ['vitest run', '@vitest/coverage-v8'] },
  { id: 'VFS-01', category: 'ingestion', type: 'code', targets: ['apps/kalio-api/src/modules/vfs/project-resource-reader.service.ts'], query: 'What hard limits does the project VFS reader enforce for files, per-file bytes, total bytes, directory depth, and entries?', evidence: ['max_files = 500', 'max_file_bytes = 1024 * 1024', 'max_total_bytes = 20 * max_file_bytes', 'max_depth = 16', 'max_entries = 5000'] },
  { id: 'VFS-02', category: 'ingestion', type: 'code', targets: ['apps/kalio-api/src/modules/vfs/project-resource-reader.service.ts'], query: 'How does project file reading defend the registered root against symlinks, path escape, and replacement while reading?', evidence: ['realpath', 'symboliclink', 'o_nofollow', 'samefile'] },
  { id: 'CHUNK-01', category: 'chunking', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-chunks.ts'], query: 'How does the resource chunker split code declarations while retaining their original source offsets and enforcing token limits?', evidence: ['chunkprojectresourcecontent', 'startoffset', 'endoffset', 'project_resource_token_limit'] },
  { id: 'INDEX-01', category: 'indexing', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-index.service.ts'], query: 'Before publishing an index, how does the service detect source files changing during embedding?', evidence: ['originalhashes', 'freshhashes', 'project_resource_source_changed'] },
  { id: 'STORE-01', category: 'storage', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-index.store.ts'], query: 'How does the SQLite resource store combine one vector table per modality, full-text search, and transactional snapshot replacement?', evidence: ['resource_types', 'resources_fts', 'vec0', 'transaction'] },
  { id: 'SPACE-01', category: 'identity', type: 'code', targets: ['apps/kalio-api/src/modules/memory/embedding-identity.ts'], query: 'Which provider and model properties are bound into an embedding-space identity so vectors from incompatible configurations cannot be mixed?', evidence: ['providerScope', 'backend', 'endpointFingerprint', 'modelRevision', 'dimensions', 'documentPromptVersion', 'queryPromptVersion'] },
  { id: 'GEMMA-01', category: 'runtime', type: 'code', targets: ['apps/kalio-api/src/modules/memory/local-transformers-embedding.provider.ts'], query: 'On Windows, what backend does local embedding auto-select, and how can the provider explicitly use WebGPU instead?', evidence: ['process.platform', 'win32', 'webgpu', 'activeBackend'] },
  { id: 'GEMMA-02', category: 'runtime', type: 'code', targets: ['apps/kalio-api/src/modules/memory/embedding-identity.ts'], query: 'What separate task prefixes are applied to Gemma documents, semantic queries, and code retrieval queries?', evidence: ['title: none | text:', 'task: search result | query:', 'task: code retrieval | query:'] },
  { id: 'OLLAMA-01', category: 'identity', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-index.service.ts'], query: 'Why does project indexing reject Ollama even after model metadata is resolved, and which guard error does it return?', evidence: ['/api/tags', 'mutable', 'embedding_immutable_inference_required'] },
  { id: 'OLLAMA-02', category: 'providers', type: 'code', targets: ['apps/kalio-api/src/modules/memory/embedding.providers.ts'], query: 'Which Ollama endpoint receives embedding requests, and what request data is sent with the input?', evidence: ['api/embed', 'input', 'dimensions'] },
  { id: 'OLLAMA-03', category: 'identity', type: 'code', targets: ['apps/kalio-api/src/modules/memory/embedding-model-identity.service.ts'], query: 'How does the model identity resolver obtain an immutable Ollama revision and what does it return if metadata is unavailable?', evidence: ['digest', 'sha256', 'modelRevision', 'unresolved'] },
  { id: 'SETTINGS-01', category: 'settings', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-context-settings.service.ts'], query: 'Is project-context indexing opt-in by default, which setting key stores the toggle, and how are identity fields returned?', evidence: ['project_context_settings', 'enabled: false', 'unresolved', 'PROJECT_CONTEXT_DISABLED'] },
  { id: 'API-01', category: 'api', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-index.controller.ts'], query: 'What authenticated API routes expose project-resource status, index refresh, and search, and where is search text carried?', evidence: ['@Controller(', '@UseGuards(ProjectResourceAuthGuard)', '@Get(', '@Put(', 'status', 'index', 'search'] },
  { id: 'UI-01', category: 'settings', type: 'code', targets: ['apps/kalio-web/src/features/settings/LocalEmbeddingConfigCard.tsx'], query: 'Which settings component lets a user select or install a local embedding model and configure Project Context?', evidence: [] },
  { id: 'ASSET-01', category: 'assets', type: 'text', targets: ['docs/spec/embedding-spaces-and-project-resources.md'], query: 'What information about image, audio, video, and PDF assets is indexed today, and which content processing is not implemented?', evidence: ['metadata', 'ocr', 'transcription'] },
  { id: 'SEARCH-01', category: 'search', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-index.store.ts'], query: 'How does project-resource search combine vector ranking with FTS5 ranking, and how are ties ordered?', evidence: ['resources_fts', 'bm25', 'distance', 'score'] },
  { id: 'CONSENT-01', category: 'api', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-index.controller.ts'], query: 'How does the project-resource request contract represent explicit consent before sending content to a remote embedding provider?', evidence: ['allowRemoteProcessing', 'REMOTE_EMBEDDING_CONSENT_REQUIRED'] },
  { id: 'CHUNK-D01', category: 'chunking-detail', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-chunks.ts'], query: 'What are the exact source-window, overlap, and context limits in project-resource-chunks.ts, and is the source limit measured in tokens or UTF-16 units?', targetChunkAnchor: 'const SOURCE_LIMIT = 2000;', evidence: ['const SOURCE_LIMIT = 2000;', 'const OVERLAP_LIMIT = 200;', 'const CONTEXT_LIMIT = 400', 'UTF-16 source offsets'] },
  { id: 'CHUNK-D02', category: 'chunking-detail', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-chunks.ts'], query: 'Which file extensions use the TypeScript parser for declaration boundaries, and does this perform type checking or module resolution?', targetChunkAnchor: 'Syntax only: no type checking', evidence: ['.ts', '.tsx', '.js', 'no type checking', 'module resolution'] },
  { id: 'CHUNK-D03', category: 'chunking-detail', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-chunks.ts'], query: 'When a top-level class exceeds the source limit, where does the chunker split it and what imports and class context are copied into member chunks?', targetChunkAnchor: 'member.getFullStart()', evidence: ['node.members', 'member.getFullStart()', 'classContext', 'importContext'] },
  { id: 'CHUNK-D04', category: 'chunking-detail', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-chunks.ts'], query: 'How are oversized non-class declarations and individual long methods split after their AST range is selected?', targetChunkAnchor: 'start + SOURCE_LIMIT, range.end', evidence: ['Math.min(start + SOURCE_LIMIT, range.end)', 'lineAt(starts, end)', 'OVERLAP_LIMIT'] },
  { id: 'HTML-D01', category: 'chunking-detail', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-chunks.ts'], query: 'Does HTML use AST-aware element or component chunking here, and how are short versus oversized HTML files handled?', targetChunkAnchor: 'kind === undefined || source.length <= SOURCE_LIMIT', evidence: ['kind === undefined', 'source.length <= SOURCE_LIMIT', 'lineStarts', 'SOURCE_LIMIT'] },
  { id: 'CHUNK-D05', category: 'chunking-detail', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-chunks.ts'], query: 'How does the actual document token-budget callback account for file labels and optional context, and what happens when even the smallest source unit does not fit?', targetChunkAnchor: 'fits(render(minimum))', evidence: ['fits(render(end))', 'File:', 'Context:', 'PROJECT_RESOURCE_TOKEN_LIMIT'] },
  { id: 'INDEX-D02', category: 'chunking-detail', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-index.service.ts'], query: 'How many resource chunks are embedded per batch, and how does indexing prevent publishing vectors for a source tree that changed during embedding?', targetChunkAnchor: 'PROJECT_RESOURCE_SOURCE_CHANGED', evidence: ['start += 32', 'originalHashes', 'freshHashes', 'PROJECT_RESOURCE_SOURCE_CHANGED', 'store.replace'] },
  { id: 'ASSET-D02', category: 'chunking-detail', type: 'code', targets: ['apps/kalio-api/src/modules/memory/project-resource-index.service.ts'], query: 'Are image, PDF, audio, and video bytes embedded, or does the index store only a metadata description for these assets?', targetChunkAnchor: 'File metadata only; binary content was not embedded.', evidence: ['representation', 'metadata', 'File metadata only', 'binary content was not embedded'] },
];
const requireApi = createRequire(path.join(ROOT, 'apps', 'kalio-api', 'package.json'));
const apiModule = name => requireApi(path.join(ROOT, 'apps', 'kalio-api', 'dist', 'modules', 'memory', name));
const { ProjectResourceIndexStore } = apiModule('project-resource-index.store.js');
const identity = apiModule('embedding-identity.js');
const localProviderModule = apiModule('local-transformers-embedding.provider.js');
const originalReport = JSON.parse(readFileSync(path.join(RUN_DIR, 'report.json'), 'utf8'));
const summary = JSON.parse(readFileSync(path.join(RUN_DIR, 'summary.json'), 'utf8'));

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function safeText(value) { return String(value).toLowerCase(); }
function fail(message) { throw new Error(message); }
function shardRoot(shard) {
  const relative = path.relative(ROOT, path.resolve(ROOT, shard.databasePath));
  const parts = relative.split(path.sep);
  if (parts.length < 5 || parts[0] !== 'data' || parts[1] !== 'b' || parts[2] !== RUN_ID) fail(`UNEXPECTED_SHARD_PATH:${relative}`);
  return path.join(ROOT, ...parts.slice(0, 5));
}
function dbDigests(model) {
  return model.sourceIndex.shards.map(shard => {
    const bytes = readFileSync(path.resolve(ROOT, shard.databasePath));
    return { path: shard.databasePath, bytes: bytes.byteLength, sha256: sha(bytes) };
  });
}
function verifyIndex(model) {
  if (!model?.space || !Array.isArray(model.sourceIndex?.shards) || model.sourceIndex.indexedChunks !== 26314) fail('BENCHMARK_INDEX_MISSING');
  const stores = model.sourceIndex.shards.map(shard => {
    const store = new ProjectResourceIndexStore(shardRoot(shard), shard.projectId, model.space);
    try {
      const status = store.status();
      if (status.indexedChunks !== shard.indexedChunks || !store.hasCurrentChunking()) fail(`INDEX_STATUS_MISMATCH:${model.model}:${shard.shard}`);
      return { shard, status };
    } finally { store.close(); }
  });
  return stores;
}
function mergeShardResults(item, vector, mode, model) {
  const selectedTypes = item.type === 'code' ? ['code'] : ['text'];
  const merged = new Map();
  for (const { shard } of model.sourceIndex.shards.map(shard => ({ shard }))) {
    const store = new ProjectResourceIndexStore(shardRoot(shard), shard.projectId, model.space);
    try {
      for (const result of store.search(item.query, vector, selectedTypes, 5, mode)) {
        const prior = merged.get(result.id);
        merged.set(result.id, { result, score: (prior?.score ?? 0) + result.score });
      }
    } finally { store.close(); }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score || a.result.id.localeCompare(b.result.id))
    .slice(0, 5).map(item => item.result);
}
function rank(results, targets) {
  const index = results.findIndex(result => targets.includes(result.path));
  return index < 0 ? null : index + 1;
}
function targetChunkRank(results, anchor) {
  if (!anchor) return null;
  const index = results.findIndex(result => result.content.toLowerCase().includes(anchor.toLowerCase()));
  return index < 0 ? null : index + 1;
}
function metric(results) {
  const count = results.length;
  return {
    hitAt1: results.filter(item => item.rank === 1).length / count,
    recallAt5: results.filter(item => item.rank !== null && item.rank <= 5).length / count,
    mrrAt5: results.reduce((sum, item) => sum + (item.rank ? 1 / item.rank : 0), 0) / count,
  };
}
function summarize(items, mode) {
  const perMode = items.map(item => ({ rank: item[mode].rank }));
  const answerEvidence = items.filter(item => item[mode].targetInTop5 && item[mode].missingEvidence.length === 0).length;
  return { targetRanking: metric(perMode), answerEvidenceCompleteAt5: answerEvidence, queryCount: items.length };
}
async function embedOllama(texts) {
  const response = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, input: texts, dimensions: 768, truncate: false, options: { num_gpu: 0 } }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) fail(`OLLAMA_EMBED_HTTP_${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.embeddings) || body.embeddings.length !== texts.length
    || body.embeddings.some(vector => !Array.isArray(vector) || vector.length !== 768 || vector.some(value => !Number.isFinite(value)))) fail('OLLAMA_VECTOR_SHAPE_INVALID');
  return body.embeddings;
}
async function evaluateModel(model, embed) {
  verifyIndex(model);
  const queryRows = [];
  const queryTimes = [];
  for (const item of QUESTIONS) {
    const purpose = item.type === 'code' ? 'code_query' : 'query';
    const prepared = identity.preparePinnedEmbeddingTexts(model.space, [item.query], purpose);
    const started = performance.now();
    const vectors = await embed(prepared);
    queryTimes.push(performance.now() - started);
    const vectorResults = mergeShardResults(item, vectors[0], 'vector', model);
    const hybridResults = mergeShardResults(item, vectors[0], 'hybrid', model);
    const anchors = item.evidence.map(safeText);
    const vectorContext = vectorResults.map(result => result.content).join('\n').toLowerCase();
    const context = hybridResults.map(result => result.content).join('\n').toLowerCase();
    const vectorMatched = anchors.filter(term => vectorContext.includes(term));
    const matchedEvidence = anchors.filter(term => context.includes(term));
    queryRows.push({
      id: item.id, category: item.category, query: item.query, targetPaths: item.targets,
      targetChunkAnchor: item.targetChunkAnchor ?? null,
      vector: {
        rank: rank(vectorResults, item.targets),
        targetChunkRank: targetChunkRank(vectorResults, item.targetChunkAnchor),
        targetInTop5: vectorResults.some(result => item.targets.includes(result.path)),
        evidenceCoverage: anchors.length ? vectorMatched.length / anchors.length : null,
        matchedEvidence: vectorMatched, missingEvidence: anchors.filter(term => !vectorContext.includes(term)),
        top5: vectorResults.map(result => ({ path: result.path, score: result.score, excerpt: result.content.slice(0, 700) })),
      },
      hybrid: {
        rank: rank(hybridResults, item.targets),
        targetChunkRank: targetChunkRank(hybridResults, item.targetChunkAnchor),
        targetInTop5: hybridResults.some(result => item.targets.includes(result.path)),
        evidenceCoverage: anchors.length ? matchedEvidence.length / anchors.length : null,
        matchedEvidence, missingEvidence: anchors.filter(term => !context.includes(term)),
        top5: hybridResults.map(result => ({ path: result.path, score: result.score, excerpt: result.content.slice(0, 700) })),
      },
    });
  }
  return {
    model: model.model, backend: model.space.backend, modelRevision: model.space.modelRevision,
    queryEmbeddingMedianMs: Math.round([...queryTimes].sort((a, b) => a - b)[Math.floor(queryTimes.length / 2)]),
    vector: summarize(queryRows, 'vector'), hybrid: summarize(queryRows, 'hybrid'),
    byCategory: Object.fromEntries([...new Set(QUESTIONS.map(item => item.category))].map(category => {
      const rows = queryRows.filter(item => item.category === category);
      return [category, { queryCount: rows.length, targetRecallAt5: metric(rows.map(item => ({ rank: item.hybrid.rank }))).recallAt5,
        answerEvidenceCompleteAt5: rows.filter(item => item.hybrid.targetInTop5 && item.hybrid.missingEvidence.length === 0).length,
        targetChunkAt5: rows.filter(item => item.targetChunkAnchor && item.hybrid.targetChunkRank !== null).length }];
    })),
    queries: queryRows,
  };
}

async function main() {
  if (originalReport.finalCorpusFingerprintVerified !== true
    || originalReport.corpus.fingerprint !== summary.corpus.fingerprint
    || originalReport.models.length !== 2 || !existsSync(GEMMA_CACHE)) fail('FULL_BENCHMARK_BASELINE_INVALID');
  const models = originalReport.models;
  const originalDigests = new Map(models.map(model => [model.model, dbDigests(model)]));
  const ollamaTags = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(10_000) }).then(response => response.json());
  const ollamaTag = ollamaTags.models?.find(item => item.name === OLLAMA_MODEL);
  const ollamaIndex = models.find(model => model.space.provider === 'ollama');
  if (!ollamaTag || ollamaTag.digest !== ollamaIndex.space.modelRevision) fail('OLLAMA_REVISION_MISMATCH');

  const gemmaIndex = models.find(model => model.space.provider === 'local-transformers');
  const gemmaProvider = new localProviderModule.LocalTransformersEmbeddingProvider({
    model: gemmaIndex.space.model, dimensions: gemmaIndex.space.dimensions,
    cacheDir: GEMMA_CACHE, backend: 'webgpu', allowRemoteModels: false,
  });
  let gemmaResult;
  try {
    gemmaResult = await evaluateModel(gemmaIndex, texts => gemmaProvider.embed(texts));
    if (gemmaProvider.getActiveBackend() !== 'webgpu') fail(`GEMMA_BACKEND_MISMATCH:${gemmaProvider.getActiveBackend()}`);
    gemmaResult.activeBackend = gemmaProvider.getActiveBackend();
  } finally { await gemmaProvider.dispose(); }
  const ollamaResult = await evaluateModel(ollamaIndex, embedOllama);
  const finalDigests = new Map(models.map(model => [model.model, dbDigests(model)]));
  for (const model of models) {
    if (JSON.stringify(originalDigests.get(model.model)) !== JSON.stringify(finalDigests.get(model.model))) fail(`INDEX_MUTATED_DURING_QUERY:${model.model}`);
  }
  mkdirSync(RUN_DIR, { recursive: true });
  const result = {
    runId: RUN_ID, createdAt: new Date().toISOString(), corpusFingerprint: originalReport.corpus.fingerprint,
    corpus: { files: originalReport.corpus.files, chunks: originalReport.corpus.chunks },
    indexPersistence: 'read-only re-open; all shard SHA-256 values unchanged before and after this query-only benchmark',
    answerGeneration: { performed: false, reason: 'Gemma and Nomic are embedding models; this test measures retrieved source evidence, not generated answer prose.' },
    rubric: { targetHit: 'expected source file appears in top 5', completeEvidence: 'expected source appears in top 5 and all question-specific evidence anchors occur in those snippets', metrics: 'same 21 questions and separate embedding/query prefixes; vector and hybrid search scored independently' },
    questionCount: QUESTIONS.length,
    models: [gemmaResult, ollamaResult], databaseDigestsUnchanged: true,
  };
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, { flag: 'w' });
  process.stdout.write(`${JSON.stringify({ output: path.relative(ROOT, OUTPUT), fingerprint: result.corpusFingerprint,
    questionCount: QUESTIONS.length, models: result.models.map(model => ({ model: model.model, backend: model.backend,
      vector: model.vector, hybrid: model.hybrid, byCategory: model.byCategory })), databaseDigestsUnchanged: true })}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
