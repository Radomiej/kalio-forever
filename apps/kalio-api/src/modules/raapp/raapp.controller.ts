import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  NotFoundException,
  ForbiddenException,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RAAppService } from './raapp.service';

interface RAAppSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  expose_as_tool: boolean;
  tool_description: string;
  source: 'core' | 'user';
  createdAt: number;
  updatedAt: number;
}

@Controller('ra-apps')
export class RAAppController {
  constructor(private readonly raAppService: RAAppService) {}

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
}
