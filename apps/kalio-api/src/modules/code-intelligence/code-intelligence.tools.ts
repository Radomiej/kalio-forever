import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../common/decorators/tool.decorator';
import { CodeIntelligenceService } from './code-intelligence.service';

@Injectable()
@Tool({
  name: 'ide_query',
  domain: 'code_intelligence',
  description: 'Use VS Code language intelligence for definitions, references, symbols, callers, callees, implementations, declarations, type definitions, and hover.',
  parameters: {
    type: 'object',
    required: ['operation'],
    properties: {
      operation: { type: 'string', enum: ['workspace_symbols', 'document_symbols', 'definition', 'declaration', 'type_definition', 'implementation', 'references', 'incoming_calls', 'outgoing_calls', 'hover'] },
      query: { type: 'string' },
      target: { type: 'object', properties: { symbol: { type: 'string' }, path: { type: 'string' }, line: { type: 'integer', minimum: 1 }, column: { type: 'integer', minimum: 1 }, kind: { type: 'string' }, container: { type: 'string' } } },
      maxResults: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
  requiresConfirmation: false,
})
export class IdeQueryTool {
  constructor(private readonly codeIntelligence: CodeIntelligenceService) {}
  execute(request: ToolCallRequest) { return this.codeIntelligence.executeQuery(request); }
}

@Injectable()
@Tool({
  name: 'ide_diagnostics',
  domain: 'code_intelligence',
  description: 'Read bounded VS Code diagnostics for one project file or the project workspace.',
  parameters: {
    type: 'object',
    required: ['scope'],
    properties: {
      scope: { type: 'string', enum: ['file', 'project'] },
      path: { type: 'string' },
      severities: { type: 'array', items: { type: 'string', enum: ['error', 'warning', 'information'] } },
      maxResults: { type: 'integer', minimum: 1, maximum: 200 },
    },
  },
  requiresConfirmation: false,
})
export class IdeDiagnosticsTool {
  constructor(private readonly codeIntelligence: CodeIntelligenceService) {}
  execute(request: ToolCallRequest) { return this.codeIntelligence.executeDiagnostics(request); }
}

@Injectable()
@Tool({
  name: 'ide_status',
  domain: 'code_intelligence',
  description: 'Report the VS Code code-intelligence backend, project trust, language providers, capabilities, and actionable readiness state.',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
})
export class IdeStatusTool {
  constructor(private readonly codeIntelligence: CodeIntelligenceService) {}
  execute(request: ToolCallRequest) { return this.codeIntelligence.executeStatus(request); }
}
