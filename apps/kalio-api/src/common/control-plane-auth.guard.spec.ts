import { afterEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ControlPlaneAuthGuard } from './control-plane-auth';
import { AllowedPathsController } from '../modules/allowed-paths/allowed-paths.controller';
import { ArchitectureRegistryController } from '../modules/architecture/architecture-registry.controller';
import { ArchitectureRunsController } from '../modules/architecture/architecture-runs.controller';
import { AgentFlowRunsController } from '../modules/agent-flow/agent-flow-runs.controller';
import { CredentialsController } from '../modules/credentials/credentials.controller';
import { CredentialsRuntimeController } from '../modules/llm/credentials-runtime.controller';
import { HitlConfigController } from '../modules/hitl/hitl-config.controller';
import { SecurityPolicyController } from '../modules/hitl/security-policy.controller';
import { SessionsController } from '../modules/chat/sessions.controller';
import { SessionVfsController } from '../modules/vfs/session-vfs.controller';
import { MCPController } from '../modules/mcp/mcp.controller';
import { LLMController } from '../modules/llm/llm.controller';
import { ToolController } from '../modules/tool/tool.controller';
import { AllowedPathsService } from '../modules/allowed-paths/allowed-paths.service';

const TOKEN = 'b'.repeat(64);

@Controller('sessions/:id/vfs')
@UseGuards(ControlPlaneAuthGuard)
class VfsAuthProbeController {
  @Get()
  list(): { ok: true } {
    return { ok: true };
  }

  @Post()
  write(): { written: true } {
    return { written: true };
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ControlPlaneAuthGuard', () => {
  it('protects all REST control-plane controller classes', () => {
    const controllers = [
      AllowedPathsController,
      ArchitectureRegistryController,
      ArchitectureRunsController,
      AgentFlowRunsController,
      CredentialsController,
      CredentialsRuntimeController,
      HitlConfigController,
      SecurityPolicyController,
      SessionsController,
      SessionVfsController,
      MCPController,
      LLMController,
      ToolController,
    ];

    for (const controller of controllers) {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[] | undefined;
      expect(guards, controller.name).toContain(ControlPlaneAuthGuard);
    }
  });

  it('denies anonymous access and allows a correctly authenticated HTTP request', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('KALIO_INSTALL_PROFILE', 'desktop');
    vi.stubEnv('KALIO_CONTROL_PLANE_TOKEN', TOKEN);

    const allowedPaths = { findAll: vi.fn().mockResolvedValue([]) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AllowedPathsController, VfsAuthProbeController],
      providers: [{ provide: AllowedPathsService, useValue: allowedPaths }],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/api/allowed-paths`;

    try {
      const anonymous = await fetch(url);
      expect(anonymous.status).toBe(401);
      expect(allowedPaths.findAll).not.toHaveBeenCalled();

      const invalid = await fetch(url, {
        headers: { Authorization: `Bearer ${'c'.repeat(64)}` },
      });
      expect(invalid.status).toBe(401);
      expect(allowedPaths.findAll).not.toHaveBeenCalled();

      const authorized = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(authorized.status).toBe(200);
      expect(await authorized.json()).toEqual([]);
      expect(allowedPaths.findAll).toHaveBeenCalledOnce();

      const vfsUrl = `http://127.0.0.1:${address.port}/api/sessions/session-1/vfs`;
      const vfsAuthorized = await fetch(vfsUrl, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(vfsAuthorized.status).toBe(200);
      expect(vfsAuthorized.headers.get('set-cookie')).toContain(
        `kalio-vfs-session-1=${TOKEN}; Path=/api/sessions/session-1/vfs; HttpOnly; Secure; SameSite=None`,
      );
      expect(vfsAuthorized.headers.get('set-cookie')).not.toContain('Max-Age=');

      const cookieRead = await fetch(vfsUrl, {
        headers: { Cookie: `kalio-vfs-session-1=${TOKEN}` },
      });
      expect(cookieRead.status).toBe(200);

      const otherSession = await fetch(vfsUrl.replace('session-1', 'session-2'), {
        headers: { Cookie: `kalio-vfs-session-1=${TOKEN}` },
      });
      expect(otherSession.status).toBe(401);

      const cookieWrite = await fetch(vfsUrl, {
        method: 'POST',
        headers: { Cookie: `kalio-vfs-session-1=${TOKEN}` },
      });
      expect(cookieWrite.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});
