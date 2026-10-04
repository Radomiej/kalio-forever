import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the existing function without starting an installed server or browser.
const source = readFileSync(new URL('./kalio-cli.mjs', import.meta.url), 'utf8');
const browserFunction = source.slice(source.indexOf('function openBrowser('), source.indexOf('async function runServer('));

function invoke(platform, disabled = false) {
  const calls = [];
  let unrefs = 0;
  const context = vm.createContext({
    process: { platform, env: { KALIO_NO_OPEN: disabled ? 'true' : 'false' } },
    spawn: (...args) => { calls.push(args); return { unref: () => { unrefs++; } }; },
  });
  vm.runInContext(browserFunction + '\nopenBrowser("http://127.0.0.1:4016");', context);
  return { calls, unrefs };
}

test('Windows browser opener hides its cmd helper and opens the intended URL once', () => {
  const { calls, unrefs } = invoke('win32');
  assert.equal(calls.length, 1);
  const [command, args, options] = calls[0];
  assert.equal(command, 'cmd.exe');
  assert.equal(JSON.stringify(args), JSON.stringify(['/c', 'start', '', 'http://127.0.0.1:4016']));
  assert.equal(options.windowsHide, true);
  assert.equal(options.detached, true);
  assert.equal(options.stdio, 'ignore');
  assert.equal(unrefs, 1);
});

test('no-open setting never spawns a browser helper', () => {
  assert.equal(invoke('win32', true).calls.length, 0);
});

test('Unix browser openers retain their platform commands', () => {
  assert.equal(invoke('darwin').calls[0][0], 'open');
  assert.equal(invoke('linux').calls[0][0], 'xdg-open');
});
