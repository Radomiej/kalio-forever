import { Inject, Injectable } from '@nestjs/common';
import { PROJECT_CONTEXT_PORT, type ProjectContextPort, type ProjectResourceSearchRequest, type ToolCallRequest } from '@kalio/types';
import { ConfirmedTool } from '../../../common/decorators/tool.decorator';

const consent = { type: 'boolean', description: 'Consent to remote embedding processing for this confirmed operation only.' };
function validate(args: ToolCallRequest['args'], search: boolean): void {
  const allowed = search ? ['query', 'mode', 'limit', 'resourceTypes', 'allowRemoteProcessing'] : ['allowRemoteProcessing'];
  if (Object.keys(args).some(key => !allowed.includes(key))
    || args.allowRemoteProcessing !== undefined && typeof args.allowRemoteProcessing !== 'boolean') throw new Error('INVALID_RESOURCE_REQUEST');
}

@Injectable()
@ConfirmedTool({ name: 'refresh_project_context', domain: 'memory',
  description: 'Refresh the resource index for the persisted project of the current session. Requires confirmation; remote processing requires explicit consent.',
  parameters: { type: 'object', additionalProperties: false, properties: { allowRemoteProcessing: consent } } })
export class RefreshProjectContextTool {
  constructor(@Inject(PROJECT_CONTEXT_PORT) private readonly context: ProjectContextPort) {}
  execute(request: ToolCallRequest): Promise<object> {
    validate(request.args, false);
    return this.context.refreshForSession(request.sessionId, { allowRemoteProcessing: request.args.allowRemoteProcessing as boolean | undefined });
  }
}

@Injectable()
@ConfirmedTool({ name: 'search_project_context', domain: 'memory',
  description: 'Search indexed resources of the persisted project of the current session. Requires confirmation; remote processing requires explicit consent.',
  parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: {
    query: { type: 'string' }, mode: { type: 'string', enum: ['vector', 'fts', 'hybrid'] },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    resourceTypes: { type: 'array', items: { type: 'string', enum: ['text', 'code', 'image', 'audio', 'video', 'pdf'] } },
    allowRemoteProcessing: consent,
  } } })
export class SearchProjectContextTool {
  constructor(@Inject(PROJECT_CONTEXT_PORT) private readonly context: ProjectContextPort) {}
  async execute(request: ToolCallRequest): Promise<object> {
    validate(request.args, true);
    return { results: await this.context.searchForSession(request.sessionId, request.args as unknown as ProjectResourceSearchRequest) };
  }
}
