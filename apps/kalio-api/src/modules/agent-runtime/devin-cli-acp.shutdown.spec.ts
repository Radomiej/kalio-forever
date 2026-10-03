import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { DevinAcpHost, DevinAcpHostRegistry } from './devin-cli-acp.host';
import { createDevinCliConfig } from './devin-cli-config';

describe('Devin ACP shutdown', () => {
  it('releases a real child cwd before cleaning its ephemeral config', async () => {
    const config = await createDevinCliConfig('swe-2', []);
    const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
      cwd: config.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const host = new DevinAcpHost('swe-2');
    Object.assign(host, { child, config });
    try {
      await host.close();
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      await expect(stat(config.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await config.cleanup();
    }
  });

  it.runIf(process.platform === 'win32')('stops the owned descendant tree without stopping an unrelated sentinel', async () => {
    const config = await createDevinCliConfig('swe-2', []);
    const idle = 'setInterval(() => undefined, 1000)';
    const sentinel = spawn(process.execPath, ['-e', idle], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const script = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e',${JSON.stringify(idle)}],{stdio:'ignore',windowsHide:true}); console.log(child.pid); ${idle}`;
    const child = spawn(process.execPath, ['-e', script], { cwd: config.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const host = new DevinAcpHost('swe-2');
    Object.assign(host, { child, config });
    try {
      const descendantPid = await new Promise<number>((resolve, reject) => {
        child.stdout.once('data', (data: Buffer) => resolve(Number(data.toString().trim())));
        child.once('error', reject);
      });
      expect(Number.isInteger(descendantPid) && descendantPid > 0).toBe(true);
      await host.close();
      expect(() => process.kill(descendantPid, 0)).toThrow();
      expect(sentinel.pid).toBeDefined();
      expect(() => process.kill(sentinel.pid!, 0)).not.toThrow();
      await expect(stat(config.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await host.close();
      sentinel.kill();
      await config.cleanup();
    }
  });

  it('coalesces concurrent close requests', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: vi.fn(() => true) });
    const cleanup = vi.fn(async () => undefined);
    const host = new DevinAcpHost('swe-2');
    Object.assign(host, { child, config: { cleanup } });
    const first = host.close();
    const second = host.close();
    expect(first).toBe(second);
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit('close', 0, null);
    await first;
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('waits for child close before deleting its working directory', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: vi.fn(() => true) });
    const cleanup = vi.fn(async () => undefined);
    const host = new DevinAcpHost('swe-2');
    Object.assign(host, { child, config: { cleanup }, connection: { close: vi.fn() } });

    const closing = host.close();
    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
    child.emit('close', 0, null);
    await closing;
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('retains failed cleanup for a later reset attempt', async () => {
    const cleanup = vi.fn().mockRejectedValueOnce(new Error('locked')).mockResolvedValue(undefined);
    const host = new DevinAcpHost('swe-2');
    Object.assign(host, { config: { cleanup } });
    await expect(host.close()).rejects.toThrow('locked');
    await host.close();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('keeps failed hosts registered until reset succeeds', async () => {
    const registry = new DevinAcpHostRegistry({} as never);
    const host = await registry.get('swe-2', 'session-1');
    const close = vi.spyOn(host, 'close').mockRejectedValueOnce(new Error('locked')).mockResolvedValue(undefined);
    await expect(registry.reset()).rejects.toThrow('Devin ACP reset failed');
    expect(await registry.get('swe-2', 'session-1')).toBe(host);
    await registry.reset();
    expect(close).toHaveBeenCalledTimes(2);
    expect(await registry.get('swe-2', 'session-1')).not.toBe(host);
  });

  it('does not hand out a replacement until reset finishes', async () => {
    const registry = new DevinAcpHostRegistry({} as never);
    const host = await registry.get('swe-2');
    let release!: () => void;
    vi.spyOn(host, 'close').mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const reset = registry.reset();
    let received = false;
    const next = registry.get('swe-2').then((value) => { received = true; return value; });
    await Promise.resolve();
    expect(received).toBe(false);
    release();
    await reset;
    expect(await next).not.toBe(host);
  });

  it('prevents a stale closed host from starting a replacement process', async () => {
    const host = new DevinAcpHost('swe-2');
    await host.close();
    await expect(host.supportsHttpMcp()).rejects.toThrow('host is closing');
  });
});
