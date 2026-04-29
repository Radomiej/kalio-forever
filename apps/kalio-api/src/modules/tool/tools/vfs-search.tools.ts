import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { VFSService } from '../../vfs/vfs.service';
import { escapeRegex, globToRegex } from './search.utils';

@Injectable()
@Tool({
  name: 'vfs_grep_search',
  description:
    'Search for text matches in files within the conversation virtual filesystem. ' +
    'Returns matching lines with file paths and line numbers.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Text or regex pattern to search for.' },
      isRegexp: { type: 'boolean', description: 'If true, treat query as a regex. Default: false.' },
      includePattern: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g. "**/*.ts"). Default: all files.',
      },
      maxResults: { type: 'integer', description: 'Maximum number of results to return. Default: 50.' },
    },
  },
  requiresConfirmation: false,
})
export class VFSGrepSearchTool {
  constructor(private readonly vfs: VFSService) {}

  async execute(
    request: ToolCallRequest,
  ): Promise<{ matches: Array<{ file: string; line: number; text: string }>; total: number }> {
    const { sessionId } = request;
    const query = request.args['query'] as string;
    const isRegexp = (request.args['isRegexp'] as boolean) ?? false;
    const includePattern = request.args['includePattern'] as string | undefined;
    const maxResults = (request.args['maxResults'] as number) ?? 50;

    const listing = this.vfs.listFiles(sessionId);

    let pattern: RegExp;
    try {
      pattern = isRegexp ? new RegExp(query, 'i') : new RegExp(escapeRegex(query), 'i');
    } catch {
      return { matches: [], total: 0 };
    }

    const globRe = includePattern ? globToRegex(includePattern) : null;

    const matches: Array<{ file: string; line: number; text: string }> = [];

    for (const file of listing.files) {
      if (matches.length >= maxResults) break;
      if (globRe && !globRe.test(file.path)) continue;

      let content: string;
      try {
        const read = this.vfs.readFile(sessionId, file.path);
        content = read.content;
      } catch {
        continue;
      }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
        if (pattern.test(lines[i])) {
          matches.push({ file: file.path, line: i + 1, text: lines[i].slice(0, 300) });
        }
      }
    }

    return { matches, total: matches.length };
  }
}

@Injectable()
@Tool({
  name: 'vfs_file_search',
  description:
    'Find files matching a glob pattern in the conversation virtual filesystem. ' +
    'Returns relative file paths within the session workspace.',
  parameters: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match (e.g. "**/*.ts", "notes/*.md").' },
      maxResults: { type: 'integer', description: 'Maximum number of results. Default: 100.' },
    },
  },
  requiresConfirmation: false,
})
export class VFSFileSearchTool {
  constructor(private readonly vfs: VFSService) {}

  async execute(request: ToolCallRequest): Promise<{ files: string[]; total: number }> {
    const { sessionId } = request;
    const pattern = request.args['pattern'] as string;
    const maxResults = (request.args['maxResults'] as number) ?? 100;

    const listing = this.vfs.listFiles(sessionId);
    const globRe = globToRegex(pattern);

    const matched = listing.files
      .filter((f) => globRe.test(f.path))
      .slice(0, maxResults)
      .map((f) => f.path);

    return { files: matched, total: matched.length };
  }
}
