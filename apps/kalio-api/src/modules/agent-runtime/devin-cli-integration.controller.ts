import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { kalioMcpBridgeUrl } from '../../common/kalio-mcp-bridge-config';
import { KalioMcpBridgeTokenService, KALIO_MCP_BRIDGE_TOKEN_MIN_LENGTH, type KalioMcpBridgeTokenSource } from '../../database/kalio-mcp-bridge-token.service';
import { DevinAcpHostRegistry, type DevinCliIntegrationStatus } from './devin-cli-acp.host';
import { DevinNativeToolsPolicyService } from './devin-native-tools-policy.service';
import type { DevinNativeToolsPolicy } from './devin-native-tools';

export interface DevinCliSettings {
  mcpBridge: {
    enabled: boolean;
    configuredBy: KalioMcpBridgeTokenSource;
    transport: 'streamable-http';
    url: string;
  };
  nativeTools: DevinNativeToolsPolicy;
}

interface UpdateDevinNativeToolsDto {
  filesystem?: unknown;
  web?: unknown;
  terminal?: unknown;
  mcpBridgeToken?: unknown;
  generateMcpBridgeToken?: unknown;
  clearMcpBridgeToken?: unknown;
}

@Controller('runtime/devin-cli')
export class DevinCliIntegrationController {
  constructor(
    private readonly registry: DevinAcpHostRegistry,
    private readonly nativeToolsPolicy: DevinNativeToolsPolicyService,
    private readonly mcpBridgeToken: KalioMcpBridgeTokenService,
  ) {}

  @Get('status')
  status(): Promise<DevinCliIntegrationStatus> {
    return this.registry.getStatus();
  }

  @Get('settings')
  async settings(): Promise<DevinCliSettings> {
    return this.toSettings(await this.nativeToolsPolicy.get());
  }

  @Patch('settings')
  async updateSettings(@Body() dto: UpdateDevinNativeToolsDto): Promise<DevinCliSettings> {
    const current = await this.nativeToolsPolicy.get();
    const next = {
      filesystem: this.readBoolean(dto?.filesystem, current.filesystem, 'filesystem'),
      web: this.readBoolean(dto?.web, current.web, 'web'),
      terminal: this.readBoolean(dto?.terminal, current.terminal, 'terminal'),
    };
    const updated = await this.nativeToolsPolicy.update(next);
    await this.updateBridgeToken(dto);
    await this.registry.reset();
    return this.toSettings(updated);
  }

  private async toSettings(nativeTools: DevinNativeToolsPolicy): Promise<DevinCliSettings> {
    const bridgeToken = await this.mcpBridgeToken.getStatus();
    return {
      mcpBridge: {
        enabled: bridgeToken.enabled,
        configuredBy: bridgeToken.source,
        transport: 'streamable-http',
        url: kalioMcpBridgeUrl(),
      },
      nativeTools,
    };
  }

  private async updateBridgeToken(dto: UpdateDevinNativeToolsDto): Promise<void> {
    const actions = [
      dto.mcpBridgeToken !== undefined,
      dto.generateMcpBridgeToken !== undefined,
      dto.clearMcpBridgeToken !== undefined,
    ].filter(Boolean).length;
    if (actions > 1) throw new BadRequestException('Choose only one MCP bridge token action.');

    if (dto.mcpBridgeToken !== undefined) {
      if (typeof dto.mcpBridgeToken !== 'string') throw new BadRequestException('mcpBridgeToken must be a string.');
      const token = dto.mcpBridgeToken.trim();
      if (token.length < KALIO_MCP_BRIDGE_TOKEN_MIN_LENGTH) {
        throw new BadRequestException(`mcpBridgeToken must be at least ${KALIO_MCP_BRIDGE_TOKEN_MIN_LENGTH} characters.`);
      }
      await this.mcpBridgeToken.setOverride(token);
      return;
    }
    if (dto.generateMcpBridgeToken !== undefined) {
      if (dto.generateMcpBridgeToken !== true) throw new BadRequestException('generateMcpBridgeToken must be true.');
      await this.mcpBridgeToken.generate();
      return;
    }
    if (dto.clearMcpBridgeToken !== undefined) {
      if (dto.clearMcpBridgeToken !== true) throw new BadRequestException('clearMcpBridgeToken must be true.');
      await this.mcpBridgeToken.clearOverride();
    }
  }

  private readBoolean(value: unknown, fallback: boolean, name: string): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new BadRequestException(`${name} must be a boolean.`);
    return value;
  }
}
