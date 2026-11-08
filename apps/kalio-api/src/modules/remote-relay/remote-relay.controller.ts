import { Controller, Post, UseGuards } from '@nestjs/common';
import { RemoteRelayControlGuard } from './remote-relay-control.guard';
import { RemoteRelayService } from './remote-relay.service';

@Controller('remote-relay')
@UseGuards(RemoteRelayControlGuard)
export class RemoteRelayController {
  constructor(private readonly relay: RemoteRelayService) {}
  @Post('pairing')
  async createPairing(): Promise<{ code: string; expiresAt: number }> {
    return this.relay.createPairing();
  }
}
