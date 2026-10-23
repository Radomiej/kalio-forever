import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ProjectContextSettingsService } from './project-context-settings.service';
import { ProjectContextSettingsGuard } from './project-context-settings.guard';
import { EmbeddingService } from './embedding.service';

@Controller('memory/project-context/settings')
@UseGuards(ProjectContextSettingsGuard)
export class ProjectContextSettingsController {
  constructor(private readonly settings: ProjectContextSettingsService, private readonly embeddings: EmbeddingService) {}
  @Get()
  async get() {
    const settings = await this.settings.get();
    return { enabled: settings.enabled, ...await this.embeddings.ensureCurrentIdentity() };
  }
  @Put()
  async put(@Body() value: unknown) {
    await this.settings.put(value);
    return this.get();
  }
}
