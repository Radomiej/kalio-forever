import { Global, Module } from '@nestjs/common';
import { DECISION_SETTINGS } from '@kalio/types';
import { CredentialsModule } from '../modules/credentials/credentials.module';
import { DecisionSettingsController } from './decision-settings.controller';
import { DecisionSettingsService } from './decision-settings.service';

@Global()
@Module({
  imports: [CredentialsModule],
  controllers: [DecisionSettingsController],
  providers: [{ provide: DECISION_SETTINGS, useClass: DecisionSettingsService }],
  exports: [DECISION_SETTINGS],
})
export class DecisionSettingsModule {}
