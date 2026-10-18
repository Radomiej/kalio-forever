import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus, totalmem } from 'node:os';

const exec = promisify(execFile);

async function workspacePath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path)) throw new Error('Path is outside the benchmark workspace');
  const target = resolve(root, path);
  if (!target.startsWith(resolve(root) + sep)) throw new Error('Path is outside the benchmark workspace');
  // Resolve existing ancestors too, so a generated project cannot redirect a tool through a symlink.
  let ancestor = target;
  for (;;) {
    try {
      const actual = await realpath(ancestor);
      if (actual !== resolve(root) && !actual.startsWith(resolve(root) + sep)) throw new Error('Path is outside the benchmark workspace');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = dirname(ancestor);
    }
  }
  return target;
}

async function runNode(root, args) {
  try {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = await exec(process.execPath, args, { cwd: root, env, timeout: 20000, maxBuffer: 128 * 1024 });
    return { exitCode: 0, output: (result.stdout + result.stderr).slice(-12000) };
  } catch (error) {
    return { exitCode: Number.isInteger(error.code) ? error.code : 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}${error.message}`.slice(-12000) };
  }
}

export async function executeBenchmarkTool(root, name, args) {
  if (name === 'multiply') {
    if (![args.a, args.b].every(Number.isFinite)) throw new Error('multiply requires finite numeric a and b');
    return { result: args.a * args.b };
  }
  if (name === 'write_file') {
    const path = await workspacePath(root, args.path);
    if (typeof args.content !== 'string' || args.content.length > 100000) throw new Error('Invalid file content');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, args.content, 'utf8');
    return { ok: true, path: args.path };
  }
  if (name === 'read_file') return (await readFile(await workspacePath(root, args.path), 'utf8')).slice(0, 100000);
  if (name === 'run_tests') {
    const tests = await runNode(root, ['--test', '--test-reporter=tap', 'index.test.mjs']);
    if (tests.exitCode !== 0) return tests;
    if (!/# tests [1-9]\d*/.test(tests.output)) return { exitCode: 1, output: tests.output + '\nNo project tests executed' };
    // Acceptance assertions are fixed by the harness, independently of the model's own tests.
    const acceptance = await runNode(root, ['--input-type=module', '-e', "import assert from 'node:assert/strict'; import {sum} from './index.mjs'; assert.equal(sum(2,3),5); assert.equal(sum(-2,3),1); assert.equal(sum(0,0),0); console.log('Independent acceptance: passed');"]);
    return { exitCode: acceptance.exitCode, output: tests.output + acceptance.output };
  }
  throw new Error(`Unknown benchmark tool: ${name}`);
}

const tools = [
  { name: 'multiply', description: 'Multiply two numbers and return the result.', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  { name: 'write_file', description: 'Write a UTF-8 file inside the project workspace.', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  { name: 'read_file', description: 'Read a UTF-8 file from the project workspace.', properties: { path: { type: 'string' } }, required: ['path'] },
  { name: 'run_tests', description: 'Run Node tests and independent acceptance checks for index.mjs exporting sum(a,b). Takes no arguments.', properties: {}, required: [] },
].map(({ name, description, properties, required }) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } }));

const cases = [
  { id: 'multiply-en', prompt: 'Use multiply with a=17 and b=23. Then answer in English with the result.', expected: 391 },
  { id: 'multiply-pl', prompt: 'Wywołaj narzędzie multiply z a=19 i b=7. Następnie odpowiedz po polsku w formacie: Wynik: liczba.', expected: 133 },
  { id: 'unicode-en', prompt: 'Write notes/zażółć.txt with exactly this content: Zażółć gęślą jaźń. Then read the file using read_file and report its contents.' },
  { id: 'unicode-pl', prompt: 'Zapisz plik notes/zażółć.txt o dokładnej treści: Zażółć gęślą jaźń. Następnie odczytaj ten plik narzędziem read_file i podaj jego treść po polsku.' },
  { id: 'project-en', prompt: 'Build a tiny dependency-free Node project. Write index.mjs exporting sum(a,b) which adds numbers, including negative numbers. Write index.test.mjs using node:test and node:assert/strict to test it. Use run_tests and fix any failures. Finish with a short English report only after tests pass.' },
  { id: 'project-pl', prompt: 'Zbuduj mały projekt Node bez zależności. Zapisz index.mjs eksportujący sum(a,b), dodający liczby, także ujemne. Zapisz index.test.mjs z testami node:test i node:assert/strict. Wywołaj run_tests, popraw ewentualne błędy i dopiero po poprawnym teście podaj krótki raport po polsku.' },
];

async function request(origin, path, body, timeout = 180000) {
  const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}

async function runCase(origin, model, item, root) {
  await mkdir(root, { recursive: true });
  const messages = [{ role: 'system', content: 'You are a careful coding assistant. Use tools to perform requested actions. Never invent tool results. Keep generated files in relative workspace paths. Answer in the user language after completing the task.' }, { role: 'user', content: item.prompt }];
  const ledger = [];
  let content = '';
  const started = Date.now();
  try {
    for (let turn = 0; turn < 10; turn++) {
      const result = await request(origin, '/api/chat', { model, messages, tools, stream: false, keep_alive: '5m', ...(model.startsWith('qwen3') ? { think: false } : {}), options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 768, num_thread: 4 } });
      messages.push(result.message);
      content = result.message.content ?? '';
      const calls = result.message.tool_calls ?? [];
      if (!calls.length) break;
      for (const call of calls) {
        const name = call.function.name;
        const args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
        let output;
        try { output = await executeBenchmarkTool(root, name, args); } catch (error) { output = { error: error.message }; }
        ledger.push({ name, args, output });
        messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(output) });
      }
    }
    let passed;
    if (item.id.startsWith('multiply')) {
      passed = ledger.some((entry) => entry.name === 'multiply' && entry.output.result === item.expected) && content.includes(String(item.expected));
      if (item.id.endsWith('-pl')) passed &&= /wynik|iloczyn/i.test(content);
    } else if (item.id.startsWith('unicode')) {
      passed = ledger.some((entry) => entry.name === 'write_file' && entry.output.ok) && ledger.some((entry) => entry.name === 'read_file' && entry.output === 'Zażółć gęślą jaźń') && (await readFile(resolve(root, 'notes/zażółć.txt'), 'utf8')) === 'Zażółć gęślą jaźń';
    } else {
      passed = ledger.some((entry) => entry.name === 'run_tests' && entry.output.exitCode === 0) && (await executeBenchmarkTool(root, 'run_tests', {})).exitCode === 0;
      if (item.id.endsWith('-pl')) passed &&= /[ąćęłńóśźż]|testy|gotow|projekt|zbudow|działa|wynik/i.test(content);
    }
    return { id: item.id, status: passed ? 'passed' : 'failed', elapsedMs: Date.now() - started, final: content, ledger, messages };
  } catch (error) {
    return { id: item.id, status: 'failed', error: error.message, elapsedMs: Date.now() - started, ledger, messages };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  const origin = value('--url', 'http://127.0.0.1:11434');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Benchmark requires an explicitly local Ollama endpoint');
  const output = resolve(value('--output', '.tmp/local-model-benchmark/results.json'));
  const models = value('--models', 'qwen3:4b,qwen2.5:3b,llama3.2:3b').split(',');
  const report = { startedAt: new Date().toISOString(), engine: await request(origin, '/api/version'), hardware: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem() }, scope: 'Ollama tool protocol and generated projects; not a claim about all Kalio tools', results: [] };
  await mkdir(dirname(output), { recursive: true });
  for (const model of models) {
    const entry = { model, cases: [] };
    try {
      if (args.includes('--pull')) await request(origin, '/api/pull', { model, stream: false }, 900000);
      const installed = await request(origin, '/api/tags');
      if (!installed.models?.some((candidate) => candidate.name === model)) throw new Error('Model is not installed');
      entry.metadata = await request(origin, '/api/show', { model });
      for (const item of cases) {
        const result = await runCase(origin, model, item, resolve(dirname(output), model.replaceAll(/[^a-zA-Z0-9._-]/g, '_'), item.id));
        entry.cases.push(result);
        console.log(`${model} ${item.id}: ${result.status} (${result.elapsedMs} ms)`);
      }
      entry.status = entry.cases.every((item) => item.status === 'passed') ? 'passed' : 'failed';
    } catch (error) {
      entry.status = 'blocked';
      entry.error = error.message;
      console.log(`${model}: blocked: ${entry.error}`);
    }
    report.results.push(entry);
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  report.completedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${output}`);
  if (report.results.some((item) => item.status !== 'passed')) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
