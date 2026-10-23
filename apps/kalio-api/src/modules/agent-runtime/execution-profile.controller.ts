import { BadRequestException, Body, ConflictException, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { CreateExecutionProfileDto, ResolveDirectExecutionProfileDto, UpdateExecutionProfileDto } from '@kalio/types';
import { ExecutionProfileService } from './execution-profile.service';
import { CodexAppServerHost } from './codex-app-server.host';
import { DevinCliModelCatalogService } from './devin-cli-model-catalog.service';
import { readCodexModels } from './codex-model-catalog';

@Controller('runtime/profiles')
export class ExecutionProfileController {
  constructor(
    private readonly profiles: ExecutionProfileService,
    private readonly codexHost: CodexAppServerHost,
    private readonly devinModelCatalog: DevinCliModelCatalogService,
  ) {}

  @Get()
  list() {
    return this.profiles.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.profiles.get(id);
  }

  @Post()
  async create(@Body() dto: CreateExecutionProfileDto) {
    if (dto.kind === 'devin-cli-acp') await this.assertDevinModelAvailable(dto.model);
    return this.profiles.create(dto);
  }

  @Post('devin-cli/resolve')
  async resolveDevinCli(@Body() dto: { model?: unknown }) {
    if (typeof dto?.model !== 'string' || !dto.model.trim()) {
      throw new BadRequestException('A Devin CLI model is required.');
    }
    const model = dto.model.trim();
    await this.assertDevinModelAvailable(model);
    return this.profiles.resolveDevinCli(model);
  }

  @Post('direct/resolve')
  resolveDirect(@Body() dto: ResolveDirectExecutionProfileDto) {
    return this.profiles.resolveDirect(dto);
  }

  @Post('codex/resolve')
  async resolveCodex(@Body() dto: { model?: unknown; authProfileId?: unknown }) {
    if (typeof dto?.model !== 'string' || !dto.model.trim()
      || typeof dto.authProfileId !== 'string' || !dto.authProfileId.trim()) {
      throw new BadRequestException('A Codex model and integration are required.');
    }
    const model = dto.model.trim();
    const authProfileId = dto.authProfileId.trim();
    const profiles = await this.profiles.list();
    if (!profiles.some(profile => profile.kind === 'codex-app-server'
      && (profile.authProfileId || profile.id) === authProfileId && profile.enabled)) {
      throw new ConflictException('The selected Codex integration is not configured or enabled.');
    }
    const connection = await this.codexHost.getConnection(authProfileId, 'model-catalog');
    if (!(await readCodexModels(connection)).includes(model)) {
      throw new ConflictException(`Codex model is not currently available: ${model}`);
    }
    return this.profiles.resolveCodex(authProfileId, model);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateExecutionProfileDto) {
    if (dto.model !== undefined) {
      const existing = await this.profiles.get(id);
      if (existing.kind === 'devin-cli-acp') await this.assertDevinModelAvailable(dto.model);
    }
    return this.profiles.update(id, dto);
  }

  private async assertDevinModelAvailable(model: string): Promise<void> {
    const catalog = await this.devinModelCatalog.getCatalog();
    if (catalog.status !== 'ready' || catalog.stale) {
      throw new ConflictException('Devin CLI model catalog is unavailable; refresh Devin CLI status and retry.');
    }
    if (!catalog.models.includes(model)) {
      throw new ConflictException(`Devin CLI model is not currently available: ${model}`);
    }
  }

  @Post(':id/login')
  async login(@Param('id') id: string, @Body() body?: { loginType?: 'chatgpt' | 'chatgptDeviceCode' }) {
    const profile = await this.profiles.assertEnabled(id);
    if (profile.kind !== 'codex-app-server') {
      throw new BadRequestException('Only Codex App Server profiles support ChatGPT login.');
    }
    return this.codexHost.login(profile.authProfileId ?? profile.id, body?.loginType ?? 'chatgptDeviceCode');
  }
}
