import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  readdirSync, readFileSync, statSync, existsSync,
} from 'node:fs';
import { resolve, normalize, join, relative } from 'node:path';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walkDir(dir: string, maxDepth: number, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...walkDir(full, maxDepth, depth + 1));
    } else {
      results.push(full);
    }
  }
  return results;
}

function globToRegex(pattern: string): RegExp {
  let r = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      r += '.*';
      i += 2;
      if (pattern[i] === '/') i++;
    } else if (ch === '*') {
      r += '[^/]*';
      i++;
    } else if (ch === '?') {
      r += '[^/]';
      i++;
    } else {
      r += escapeRegex(ch);
      i++;
    }
  }
  return new RegExp(r + '$');
}

@Injectable()
@Tool({
  name: 'grep_search',
  description: 'Search for text matches in files under the workspace root. Returns matching lines with file paths and line numbers.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Text or regex pattern to search for.' },
      isRegexp: { type: 'boolean', description: 'If true, treat query as a regex. Default: false.' },
      includePattern: { type: 'string', description: 'Glob pattern to filter files (e.g. "**/*.ts"). Default: all files.' },
      maxResults: { type: 'integer', description: 'Maximum number of results to return. Default: 50.' },
    },
  },
  requiresConfirmation: false,
})
export class GrepSearchTool {
  private readonly allowedRoot: string;

  constructor(private readonly config: ConfigService) {
    this.allowedRoot = resolve(this.config.get<string>('WORKSPACE_ROOT', './data/workspaces'));
  }

  async execute(request: ToolCallRequest): Promise<{ matches: Array<{ file: string; line: number; text: string }>; total: number }> {
    const query = request.args['query'] as string;
    const isRegexp = (request.args['isRegexp'] as boolean) ?? false;
    const includePattern = request.args['includePattern'] as string | undefined;
    const maxResults = (request.args['maxResults'] as number) ?? 50;

    if (!existsSync(this.allowedRoot)) {
      return { matches: [], total: 0 };
    }

    const pattern = isRegexp ? new RegExp(query, 'i') : new RegExp(escapeRegex(query), 'i');
    const globRe = includePattern ? globToRegex(includePattern) : null;

    const allFiles = walkDir(this.allowedRoot, 10);
    const matches: Array<{ file: string; line: number; text: string }> = [];

    for (const absPath of allFiles) {
      if (matches.length >= maxResults) break;
      const relPath = relative(this.allowedRoot, absPath);
      if (globRe && !globRe.test(relPath) && !globRe.test(absPath)) continue;

      let content: string;
      try {
        const stat = statSync(absPath);
        if (stat.size > 512 * 1024) continue;
        content = readFileSync(absPath, 'utf8');
      } catch {
        continue;
      }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
        if (pattern.test(lines[i])) {
          matches.push({ file: relPath, line: i + 1, text: lines[i].slice(0, 300) });
        }
      }
    }

    return { matches, total: matches.length };
  }
}

@Injectable()
@Tool({
  name: 'file_search',
  description: 'Find files matching a glob pattern under the workspace root. Returns relative file paths.',
  parameters: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match (e.g. "**/*.ts", "src/**/*.json").' },
      maxResults: { type: 'integer', description: 'Maximum number of results. Default: 100.' },
    },
  },
  requiresConfirmation: false,
})
export class FileSearchTool {
  private readonly allowedRoot: string;

  constructor(private readonly config: ConfigService) {
    this.allowedRoot = resolve(this.config.get<string>('WORKSPACE_ROOT', './data/workspaces'));
  }

  async execute(request: ToolCallRequest): Promise<{ files: string[]; total: number }> {
    const pattern = request.args['pattern'] as string;
    const maxResults = (request.args['maxResults'] as number) ?? 100;

    if (!existsSync(this.allowedRoot)) {
      return { files: [], total: 0 };
    }

    const globRe = globToRegex(pattern);
    const allFiles = walkDir(this.allowedRoot, 10);
    const matched: string[] = [];

    for (const absPath of allFiles) {
      if (matched.length >= maxResults) break;
      const relPath = relative(this.allowedRoot, absPath);
      if (globRe.test(relPath) || globRe.test(absPath)) {
        matched.push(relPath);
      }
    }

    return { files: matched, total: matched.length };
  }
}
