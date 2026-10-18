import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeBenchmarkTool } from './local-model-benchmark.mjs';

test('benchmark tools write and read Polish text inside the selected workspace', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'kalio-model-tools-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await executeBenchmarkTool(root, 'write_file', { path: 'notes/zażółć.txt', content: 'Zażółć gęślą jaźń' });
  assert.equal(await executeBenchmarkTool(root, 'read_file', { path: 'notes/zażółć.txt' }), 'Zażółć gęślą jaźń');
  assert.equal(readFileSync(join(root, 'notes/zażółć.txt'), 'utf8'), 'Zażółć gęślą jaźń');
  await assert.rejects(executeBenchmarkTool(root, 'write_file', { path: '../escape', content: 'bad' }), /outside/);
  await assert.rejects(executeBenchmarkTool(root, 'write_file', { path: '/tmp/escape', content: 'bad' }), /outside/);
  await assert.rejects(executeBenchmarkTool(root, 'shell', { command: 'anything' }), /Unknown/);
});

test('benchmark build tool runs actual Node tests in the generated project', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'kalio-model-project-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await executeBenchmarkTool(root, 'write_file', { path: 'index.mjs', content: 'export const sum = (a,b) => a+b;\n' });
  await executeBenchmarkTool(root, 'write_file', { path: 'index.test.mjs', content: "import test from 'node:test'; import assert from 'node:assert/strict'; import {sum} from './index.mjs'; test('sum',()=>assert.equal(sum(2,3),5));\n" });
  const result = await executeBenchmarkTool(root, 'run_tests', {});
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /pass 1/);
  await executeBenchmarkTool(root, 'write_file', { path: 'index.mjs', content: 'export const sum = () => 0;\n' });
  await executeBenchmarkTool(root, 'write_file', { path: 'index.test.mjs', content: "import test from 'node:test'; test('trivial',()=>{});\n" });
  assert.notEqual((await executeBenchmarkTool(root, 'run_tests', {})).exitCode, 0, 'independent acceptance must reject a broken implementation even when generated tests pass');
});
