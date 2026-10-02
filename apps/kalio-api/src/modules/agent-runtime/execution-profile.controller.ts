import { BadRequestException, Body, ConflictException, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { CreateExecutionProfileDto, ResolveDirectExecutionProfileDto, UpdateExecutionProfileDto } from '@kalio/types';
import { ExecutionProfileService } from './execution-profile.service';
import { CodexAppServerHost } from './codex-app-server.host';
import { DevinCliModelCatalogService } from './devin-cli-model-catalog.service';

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
