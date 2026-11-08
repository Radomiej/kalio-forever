import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { ArchitectureModule } from '../architecture/architecture.module';
import { RemoteRelayService } from './remote-relay.service';
import { RemoteRelayController } from './remote-relay.controller';
import { RemoteRelayControlGuard } from './remote-relay-control.guard';

@Module({
  imports: [ChatModule, ArchitectureModule],
  controllers: [RemoteRelayController],
  providers: [RemoteRelayService, RemoteRelayControlGuard],
  exports: [RemoteRelayService],
})
export class RemoteRelayModule {}
