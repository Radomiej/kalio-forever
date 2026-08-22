import { Controller, Get } from '@nestjs/common';
import { DevinAcpHostRegistry, type DevinCliIntegrationStatus } from './devin-cli-acp.host';

@Controller('runtime/devin-cli')
export class DevinCliIntegrationController {
  constructor(private readonly registry: DevinAcpHostRegistry) {}

  @Get('status')
  status(): Promise<DevinCliIntegrationStatus> {
    return this.registry.getStatus();
  }
}
