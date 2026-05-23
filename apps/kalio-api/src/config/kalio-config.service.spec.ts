import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KalioConfigService } from './kalio-config.service';

async function writeToml(filePath: string, content: string): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

describe('KalioConfigService', () => {
  const tempDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all([...tempDirs].map((dirPath) => rm(dirPath, { recursive: true, force: true })));
    tempDirs.clear();
  });

  it('returns an empty config when no TOML layers exist', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'kalio-config-empty-'));
    tempDirs.add(tempRoot);

    const service = new KalioConfigService();
    const result = await service.loadEffectiveConfig({
      cwd: join(tempRoot, 'repo'),
      homeDir: join(tempRoot, 'home'),
    });

    expect(result.layers).toHaveLength(0);
    expect(result.config).toStrictEqual({});
  });

  it('loads user-level config from ~/.kalio/config.toml', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'kalio-config-user-'));
    tempDirs.add(tempRoot);

    const homeDir = join(tempRoot, 'home');
    await mkdir(homeDir, { recursive: true });
    await writeToml(
      join(homeDir, '.kalio', 'config.toml'),
      [
        '[runtime]',
        'context_window_size = 64000',
        'max_tool_attempts = 6',
        '',
        '[cli_agents.codex]',
        'model = "gpt-5.4"',
      ].join('\n'),
    );

    const service = new KalioConfigService();
    const result = await service.loadEffectiveConfig({ cwd: tempRoot, homeDir });

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.scope).toBe('user');
    expect(result.config.runtime?.context_window_size).toBe(64000);
    expect(result.config.runtime?.max_tool_attempts).toBe(6);
    expect(result.config.cli_agents?.codex?.model).toBe('gpt-5.4');
  });

  it('merges user and project layers with the closest project config winning', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'kalio-config-merge-'));
    tempDirs.add(tempRoot);

    const homeDir = join(tempRoot, 'home');
    const repoDir = join(tempRoot, 'repo');
    const nestedDir = join(repoDir, 'apps', 'kalio-api');

    await mkdir(join(repoDir, '.git'), { recursive: true });
    await mkdir(homeDir, { recursive: true });
    await mkdir(nestedDir, { recursive: true });

    await writeToml(
      join(homeDir, '.kalio', 'config.toml'),
      [
        '[runtime]',
        'context_window_size = 48000',
        'max_tool_attempts = 4',
        '',
        '[mcp_servers.docs]',
        'command = "npx"',
        'args = ["-y", "docs-server"]',
        'enabled = true',
      ].join('\n'),
    );

    await writeToml(
      join(repoDir, '.kalio', 'config.toml'),
      [
        '[runtime]',
        'max_tool_attempts = 8',
        '',
        '[features]',
        'mcp = true',
        '',
        '[mcp_servers.docs]',
        'enabled = false',
        'disabled_tools = ["delete"]',
      ].join('\n'),
    );

    await writeToml(
      join(repoDir, 'apps', '.kalio', 'config.toml'),
      [
        '[runtime]',
        'context_window_size = 128000',
      ].join('\n'),
    );

    const service = new KalioConfigService();
    const result = await service.loadEffectiveConfig({ cwd: nestedDir, homeDir });

    expect(result.layers).toHaveLength(3);
    expect(result.layers.map((layer) => layer.scope)).toStrictEqual(['user', 'project', 'project']);
    expect(result.config.runtime?.context_window_size).toBe(128000);
    expect(result.config.runtime?.max_tool_attempts).toBe(8);
    expect(result.config.features?.mcp).toBe(true);
    expect(result.config.mcp_servers?.docs?.command).toBe('npx');
    expect(result.config.mcp_servers?.docs?.enabled).toBe(false);
    expect(result.config.mcp_servers?.docs?.disabled_tools).toStrictEqual(['delete']);
  });

  it('ignores parent .kalio layers above the detected project root', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'kalio-config-root-'));
    tempDirs.add(tempRoot);

    const homeDir = join(tempRoot, 'home');
    const outsideDir = join(tempRoot, 'outside');
    const repoDir = join(outsideDir, 'repo');
    const nestedDir = join(repoDir, 'src');

    await mkdir(join(repoDir, '.git'), { recursive: true });
    await mkdir(nestedDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });

    await writeToml(
      join(outsideDir, '.kalio', 'config.toml'),
      [
        '[runtime]',
        'max_tool_attempts = 1',
      ].join('\n'),
    );

    await writeToml(
      join(repoDir, '.kalio', 'config.toml'),
      [
        '[runtime]',
        'max_tool_attempts = 9',
      ].join('\n'),
    );

    const service = new KalioConfigService();
    const result = await service.loadEffectiveConfig({ cwd: nestedDir, homeDir });

    expect(result.layers).toHaveLength(1);
    expect(result.config.runtime?.max_tool_attempts).toBe(9);
  });

  it('throws a file-specific error when a config layer contains invalid TOML', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'kalio-config-invalid-'));
    tempDirs.add(tempRoot);

    const homeDir = join(tempRoot, 'home');
    await mkdir(homeDir, { recursive: true });
    const configPath = join(homeDir, '.kalio', 'config.toml');
    await writeToml(configPath, '[runtime\nmax_tool_attempts = 4');

    const service = new KalioConfigService();

    await expect(service.loadEffectiveConfig({ cwd: tempRoot, homeDir })).rejects.toThrow(
      `Failed to parse Kalio config at ${configPath}`,
    );
  });
});