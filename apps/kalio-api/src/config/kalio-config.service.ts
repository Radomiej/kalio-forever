import { Injectable } from '@nestjs/common';
import * as TOML from '@iarna/toml';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type {
  KalioConfig,
  KalioConfigLayer,
  KalioConfigLoadOptions,
  KalioEffectiveConfig,
} from './kalio-config.types';

const DEFAULT_PROJECT_ROOT_MARKERS = ['.git'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override as T;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] = isPlainObject(existing) && isPlainObject(value)
      ? deepMerge(existing, value)
      : value;
  }

  return result as T;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function getParentDir(dirPath: string): string | null {
  const parentDir = dirname(dirPath);
  return parentDir === dirPath ? null : parentDir;
}

function buildKalioConfigPath(baseDir: string): string {
  return join(baseDir, '.kalio', 'config.toml');
}

function normalizeParsedConfig(raw: unknown, filePath: string): KalioConfig {
  if (!isPlainObject(raw)) {
    throw new Error(`Kalio config must parse to a TOML table: ${filePath}`);
  }

  return raw as KalioConfig;
}

@Injectable()
export class KalioConfigService {
  private cachedDefaultConfig: KalioEffectiveConfig | null = null;

  async getEffectiveConfig(): Promise<KalioEffectiveConfig> {
    if (this.cachedDefaultConfig) {
      return this.cachedDefaultConfig;
    }

    const effective = await this.loadEffectiveConfig();
    this.cachedDefaultConfig = effective;
    return effective;
  }

  async loadEffectiveConfig(options: KalioConfigLoadOptions = {}): Promise<KalioEffectiveConfig> {
    const homeDirPath = resolve(options.homeDir ?? homedir());
    const cwdPath = resolve(options.cwd ?? process.cwd());
    const projectRootMarkers = options.projectRootMarkers ?? DEFAULT_PROJECT_ROOT_MARKERS;
    const layers: KalioConfigLayer[] = [];

    const userConfigPath = buildKalioConfigPath(homeDirPath);
    const userConfig = await this.readConfigFile(userConfigPath);
    if (userConfig) {
      layers.push({ scope: 'user', path: userConfigPath, config: userConfig });
    }

    const projectConfigPaths = await this.findProjectConfigPaths(cwdPath, projectRootMarkers);
    for (const configPath of projectConfigPaths) {
      const projectConfig = await this.readConfigFile(configPath);
      if (projectConfig) {
        layers.push({ scope: 'project', path: configPath, config: projectConfig });
      }
    }

    const config = layers.reduce<KalioConfig>((merged, layer) => deepMerge(merged, layer.config), {});
    return { config, layers };
  }

  invalidateCache(): void {
    this.cachedDefaultConfig = null;
  }

  private async readConfigFile(filePath: string): Promise<KalioConfig | null> {
    if (!await fileExists(filePath)) {
      return null;
    }

    const raw = await readFile(filePath, 'utf8');
    try {
      return normalizeParsedConfig(TOML.parse(raw), filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse Kalio config at ${filePath}: ${message}`);
    }
  }

  private async findProjectConfigPaths(cwdPath: string, projectRootMarkers: string[]): Promise<string[]> {
    const projectRoot = await this.findProjectRoot(cwdPath, projectRootMarkers);
    if (!projectRoot) {
      const localConfigPath = buildKalioConfigPath(cwdPath);
      return await fileExists(localConfigPath) ? [localConfigPath] : [];
    }

    const directories: string[] = [];
    let currentDir: string | null = cwdPath;
    while (currentDir !== null) {
      directories.push(currentDir);
      if (currentDir === projectRoot) {
        break;
      }
      currentDir = getParentDir(currentDir);
    }

    const paths: string[] = [];
    for (const dirPath of directories.reverse()) {
      const configPath = buildKalioConfigPath(dirPath);
      if (await fileExists(configPath)) {
        paths.push(configPath);
      }
    }

    return paths;
  }

  private async findProjectRoot(cwdPath: string, projectRootMarkers: string[]): Promise<string | null> {
    let currentDir: string | null = cwdPath;
    while (currentDir !== null) {
      for (const marker of projectRootMarkers) {
        if (await fileExists(join(currentDir, marker))) {
          return currentDir;
        }
      }
      currentDir = getParentDir(currentDir);
    }

    return null;
  }
}