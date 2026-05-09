import { Injectable } from '@nestjs/common';
import {
  readdirSync, readFileSync, statSync, existsSync,
} from 'node:fs';
import { resolve, join, relative } from 'node:path';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';
import { escapeRegex, globToRegex } from './search.utils';

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

@Injectable()
@Tool({
  name: 'grep_search',
  description: 'Search for text matches in files under configured allowed directories. Returns matching lines with file paths and line numbers.',
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
  constructor(private readonly allowedPaths: AllowedPathsService) {}

  async execute(request: ToolCallRequest): Promise<{ matches: Array<{ file: string; line: number; text: string }>; total: number }> {
    const query = request.args['query'] as string;
    const isRegexp = (request.args['isRegexp'] as boolean) ?? false;
    const includePattern = request.args['includePattern'] as string | undefined;
    const maxResults = (request.args['maxResults'] as number) ?? 50;

    const roots = await this.allowedPaths.getRoots();
    if (roots.length === 0) {
      return { matches: [], total: 0 };
    }

    let pattern: RegExp;
    try {
      pattern = isRegexp ? new RegExp(query, 'i') : new RegExp(escapeRegex(query), 'i');
    } catch {
      return { matches: [], total: 0 };
    }

    const globRe = includePattern ? globToRegex(includePattern) : null;

    const matches: Array<{ file: string; line: number; text: string }> = [];

    for (const root of roots) {
      if (!existsSync(root)) continue;
      const allFiles = walkDir(root, 10);

      for (const absPath of allFiles) {
        if (matches.length >= maxResults) break;
        const relPath = relative(root, absPath);
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
            matches.push({ file: absPath, line: i + 1, text: lines[i].slice(0, 300) });
          }
        }
      }
    }

    return { matches, total: matches.length };
  }
}

@Injectable()
@Tool({
  name: 'file_search',
  description: 'Find files matching a glob pattern under configured allowed directories. Returns absolute file paths.',
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
  constructor(private readonly allowedPaths: AllowedPathsService) {}

  async execute(request: ToolCallRequest): Promise<{ files: string[]; total: number }> {
    const pattern = request.args['pattern'] as string;
    const maxResults = (request.args['maxResults'] as number) ?? 100;

    const roots = await this.allowedPaths.getRoots();
    if (roots.length === 0) {
      return { files: [], total: 0 };
    }

    const globRe = globToRegex(pattern);
    const matched: string[] = [];

    for (const root of roots) {
      if (!existsSync(root)) continue;
      const allFiles = walkDir(root, 10);

      for (const absPath of allFiles) {
        if (matched.length >= maxResults) break;
        const relPath = relative(root, absPath);
        if (globRe.test(relPath) || globRe.test(absPath)) {
          matched.push(absPath);
        }
      }
    }

    return { files: matched, total: matched.length };
  }
}
