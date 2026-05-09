import {
  Body,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { RAAppSummary, RAAppGroup } from '@kalio/types';
import { RAAppService } from './raapp.service';
import { RAAppVersioningService, deriveSlug } from './raapp-versioning.service';

@Controller('ra-apps')
export class RAAppController {
  constructor(
    private readonly raAppService: RAAppService,
    private readonly versioningService: RAAppVersioningService,
  ) {}

  @Get()
  list(): RAAppSummary[] {
    return this.raAppService.getAll().map((app) => ({
      id: app.id,
      name: app.meta.name,
      description: app.meta.description ?? '',
      version: app.meta.version ?? '1.0',
      tags: app.meta.tags ?? [],
      expose_as_tool: app.meta.expose_as_tool ?? false,
      tool_description: app.meta.tool_description ?? '',
      source: app.source,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    }));
  }

  // ── Versioning / group endpoints ────────────────────────────────────────────
  // IMPORTANT: @Get('groups') and @Get('groups/:slug') must appear BEFORE @Get(':id')
  // because NestJS/Express matches routes in declaration order — ':id' would shadow 'groups'.

  @Get('groups')
  listGroups(): RAAppGroup[] {
    return this.versioningService.getGroups();
  }

  @Get('groups/:slug')
  getGroup(@Param('slug') slug: string): RAAppGroup {
    const group = this.versioningService.getGroupBySlug(slug);
    if (!group) throw new NotFoundException(`RA-App group not found: ${slug}`);
    return group;
  }

  @Get(':id')
  getOne(@Param('id') id: string): RAAppSummary {
    const app = this.raAppService.getById(id);
    if (!app) throw new NotFoundException(`RA-App not found: ${id}`);
    return {
      id: app.id,
      name: app.meta.name,
      description: app.meta.description ?? '',
      version: app.meta.version ?? '1.0',
      tags: app.meta.tags ?? [],
      expose_as_tool: app.meta.expose_as_tool ?? false,
      tool_description: app.meta.tool_description ?? '',
      source: app.source,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File): Promise<RAAppSummary> {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!file.originalname.endsWith('.zip')) throw new BadRequestException('Only .zip files are accepted');
    const app = await this.raAppService.saveUpload(file.buffer, file.originalname);
    return {
      id: app.id,
      name: app.meta.name,
      description: app.meta.description ?? '',
      version: app.meta.version ?? '1.0',
      tags: app.meta.tags ?? [],
      expose_as_tool: app.meta.expose_as_tool ?? false,
      tool_description: app.meta.tool_description ?? '',
      source: app.source,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: boolean }> {
    const app = this.raAppService.getById(id);
    if (!app) throw new NotFoundException(`RA-App not found: ${id}`);
    if (app.source === 'core') throw new ForbiddenException('Cannot delete core RA-Apps');
    await this.raAppService.delete(id);
    return { ok: true };
  }

  // ── Remaining group endpoints (POST/DELETE have no shadowing conflict) ──────

  @Post('groups/:slug/draft')
  @UseInterceptors(FileInterceptor('file'))
  async saveDraft(
    @Param('slug') slug: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<RAAppGroup> {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!file.originalname.endsWith('.zip')) throw new BadRequestException('Only .zip files are accepted');
    return this.versioningService.saveAsDraft(slug, file.buffer);
  }

  @Post('groups/:slug/approve')
  async approveDraft(
    @Param('slug') slug: string,
    @Body() body: { bumpType?: 'patch' | 'minor' | 'major' },
  ): Promise<RAAppGroup> {
    const bumpType = body?.bumpType ?? 'minor';
    if (!['patch', 'minor', 'major'].includes(bumpType)) {
      throw new BadRequestException(`Invalid bumpType: ${bumpType}`);
    }
    const group = this.versioningService.getGroupBySlug(slug);
    if (!group) throw new NotFoundException(`RA-App group not found: ${slug}`);
    return this.versioningService.approveDraft(slug, bumpType);
  }

  @Post('groups/:slug/discard-draft')
  async discardDraft(@Param('slug') slug: string): Promise<RAAppGroup> {
    const group = this.versioningService.getGroupBySlug(slug);
    if (!group) throw new NotFoundException(`RA-App group not found: ${slug}`);
    return this.versioningService.discardDraft(slug);
  }

  @Post('groups/:slug/rollback/:version')
  async rollback(
    @Param('slug') slug: string,
    @Param('version') version: string,
  ): Promise<RAAppGroup> {
    const group = this.versioningService.getGroupBySlug(slug);
    if (!group) throw new NotFoundException(`RA-App group not found: ${slug}`);
    return this.versioningService.rollback(slug, version);
  }

  @Delete('groups/:slug')
  async deleteGroup(@Param('slug') slug: string): Promise<{ ok: boolean }> {
    const group = this.versioningService.getGroupBySlug(slug);
    if (!group) throw new NotFoundException(`RA-App group not found: ${slug}`);
    await this.versioningService.deleteGroup(slug);
    return { ok: true };
  }

  /** Derive a slug from a display name (utility for FE). */
  @Post('groups/slug')
  deriveSlug(@Body() body: { name: string }): { slug: string } {
    if (!body?.name) throw new BadRequestException('name is required');
    return { slug: deriveSlug(body.name) };
  }
}
