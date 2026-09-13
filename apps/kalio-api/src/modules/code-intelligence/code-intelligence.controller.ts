import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { CodeIntelligenceIntegrationPatch, ProjectIdeIntegrationPatch } from '@kalio/types';
import { CodeIntelligenceService } from './code-intelligence.service';

@Controller('code-intelligence')
export class CodeIntelligenceController {
  constructor(private readonly codeIntelligence: CodeIntelligenceService) {}

  @Get('integration')
  getIntegration() { return this.codeIntelligence.getIntegration(); }

  @Patch('integration')
  updateIntegration(@Body() patch: CodeIntelligenceIntegrationPatch) { return this.codeIntelligence.updateIntegration(patch); }

  @Post('integration/detect')
  detect() { return this.codeIntelligence.detect(); }

  @Get('projects/:projectId/integration')
  getProject(@Param('projectId') projectId: string) { return this.codeIntelligence.getProject(projectId); }

  @Patch('projects/:projectId/integration')
  updateProject(@Param('projectId') projectId: string, @Body() patch: ProjectIdeIntegrationPatch) { return this.codeIntelligence.updateProject(projectId, patch); }

  @Post('projects/:projectId/test')
  testProject(@Param('projectId') projectId: string) { return this.codeIntelligence.testProject(projectId); }

  @Post('projects/:projectId/restart')
  restartProject(@Param('projectId') projectId: string) { return this.codeIntelligence.restartProject(projectId); }

  @Post('projects/:projectId/stop')
  stopProject(@Param('projectId') projectId: string) { return this.codeIntelligence.stopProject(projectId); }
}
