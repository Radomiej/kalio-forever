import { Controller, Get } from '@nestjs/common';
import { DevinApiClient, type DevinIntegrationStatus } from './devin-api.client';

@Controller('runtime/devin')
export class DevinIntegrationController {
  constructor(private readonly client: DevinApiClient) {}

  @Get('status')
  status(): DevinIntegrationStatus {
    return this.client.getIntegrationStatus();
  }
}
