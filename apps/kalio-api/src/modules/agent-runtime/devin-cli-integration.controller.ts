import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { isKalioMcpBridgeEnabled, kalioMcpBridgeUrl } from '../../common/kalio-mcp-bridge-config';
import { DevinAcpHostRegistry, type DevinCliIntegrationStatus } from './devin-cli-acp.host';
import { DevinNativeToolsPolicyService } from './devin-native-tools-policy.service';
import type { DevinNativeToolsPolicy } from './devin-native-tools';

export interface DevinCliSettings {
  mcpBridge: { enabled: boolean; transport: 'streamable-http'; url: string };
  nativeTools: DevinNativeToolsPolicy;
}

interface UpdateDevinNativeToolsDto {
  filesystem?: unknown;
  web?: unknown;
  terminal?: unknown;
}

@Controller('runtime/devin-cli')
export class DevinCliIntegrationController {
  constructor(
    private readonly registry: DevinAcpHostRegistry,
    private readonly nativeToolsPolicy: DevinNativeToolsPolicyService,
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
    await this.registry.reset();
    return this.toSettings(updated);
  }

  private toSettings(nativeTools: DevinNativeToolsPolicy): DevinCliSettings {
    return {
      mcpBridge: {
        enabled: isKalioMcpBridgeEnabled(),
        transport: 'streamable-http',
        url: kalioMcpBridgeUrl(),
      },
      nativeTools,
    };
  }

  private readBoolean(value: unknown, fallback: boolean, name: string): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new BadRequestException(`${name} must be a boolean.`);
    return value;
  }
}
