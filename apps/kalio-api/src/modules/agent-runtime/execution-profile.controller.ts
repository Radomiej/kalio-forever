import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { CreateExecutionProfileDto, ResolveDirectExecutionProfileDto, UpdateExecutionProfileDto } from '@kalio/types';
import { ExecutionProfileService } from './execution-profile.service';
import { CodexAppServerHost } from './codex-app-server.host';

@Controller('runtime/profiles')
export class ExecutionProfileController {
  constructor(
    private readonly profiles: ExecutionProfileService,
    private readonly codexHost: CodexAppServerHost,
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
  create(@Body() dto: CreateExecutionProfileDto) {
    return this.profiles.create(dto);
  }

  @Post('direct/resolve')
  resolveDirect(@Body() dto: ResolveDirectExecutionProfileDto) {
    return this.profiles.resolveDirect(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExecutionProfileDto) {
    return this.profiles.update(id, dto);
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
