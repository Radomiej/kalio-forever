import { BadRequestException, Body, Controller, Get, HttpException, Param, Put, UseGuards } from '@nestjs/common';
import type { ProjectResourceIndexRequest, ProjectResourceSearchRequest } from '@kalio/types';
import { ProjectResourceAuthGuard } from './project-resource-auth.guard';
import { ProjectResourceIndexService } from './project-resource-index.service';

function body(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) throw new BadRequestException('INVALID_RESOURCE_REQUEST');
  const input = value as Record<string, unknown>;
  if (input.allowRemoteProcessing !== undefined && typeof input.allowRemoteProcessing !== 'boolean') throw new BadRequestException('INVALID_RESOURCE_REQUEST');
  return input;
}
async function response<T>(operation: () => T | Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    if (!(error instanceof Error)) throw error;
    if ('code' in error && error.code === 'SQLITE_FULL') throw new HttpException({ code: 'PROJECT_RESOURCE_STORAGE_LIMIT' }, 413);
    const codes: Record<string, number> = { PROJECT_CONTEXT_DISABLED: 403, INVALID_PROJECT_ID: 400, INVALID_RESOURCE_SEARCH: 400,
      PROJECT_NOT_REGISTERED: 404, PROJECT_ROOT_INVALID: 409, PROJECT_RESOURCE_LIMIT: 413,
      PROJECT_RESOURCE_CHUNK_LIMIT: 413, PROJECT_RESOURCE_INDEX_BUSY: 409, PROJECT_RESOURCE_CHANGED: 409,
      PROJECT_RESOURCE_TOKEN_LIMIT: 413, EMBEDDING_INPUT_TOO_LONG: 400,
      EMBEDDING_TOKENIZER_UNAVAILABLE: 503, EMBEDDING_TOKENIZER_INVALID: 503,
      PROJECT_RESOURCE_STORAGE_LIMIT: 413,
      PROJECT_RESOURCE_SOURCE_CHANGED: 409, PROJECT_RESOURCE_REINDEX_REQUIRED: 409,
      EMBEDDING_SPACE_CHANGED: 409, REMOTE_EMBEDDING_CONSENT_REQUIRED: 403,
      PROJECT_RESOURCE_INDEX_CHANGED: 409, EMBEDDING_REVISION_REQUIRED: 409,
      EMBEDDING_IMMUTABLE_INFERENCE_REQUIRED: 409,
      EMBEDDING_PROVIDER_UNAVAILABLE: 503, EMBEDDING_SPACE_UNAVAILABLE: 503 };
    const status = codes[error.message];
    if (status) throw new HttpException({ code: error.message }, status);
    throw error;
  }
}

@Controller('memory/project-resources/:projectId')
@UseGuards(ProjectResourceAuthGuard)
export class ProjectResourceIndexController {
  constructor(private readonly resources: ProjectResourceIndexService) {}
  @Get('status')
  status(@Param('projectId') projectId: string) { return response(() => this.resources.status(projectId)); }
  @Put('index')
  index(@Param('projectId') projectId: string, @Body() value: unknown) {
    const input = body(value, ['allowRemoteProcessing']) as ProjectResourceIndexRequest;
    return response(() => this.resources.index(projectId, input));
  }
  // Query stays in a JSON body, not in URL/history/access-log query strings.
  @Put('search')
  search(@Param('projectId') projectId: string, @Body() value: unknown) {
    const input = body(value, ['query', 'resourceTypes', 'limit', 'mode', 'allowRemoteProcessing']) as unknown as ProjectResourceSearchRequest;
    return response(() => this.resources.search(projectId, input));
  }
}
