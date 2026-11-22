import { Global, Module } from '@nestjs/common';
import { DECISION_SETTINGS } from '@kalio/types';
import { CredentialsModule } from '../modules/credentials/credentials.module';
import { DecisionSettingsService } from './decision-settings.service';
import { DecisionAuthService } from './decision-auth.service';
import { DecisionAuthGuard } from './decision-auth.guard';
import { DecisionAuthController } from './decision-auth.controller';
import { DecisionSettingsController } from './decision-settings.controller';
import { DecisionOllamaModelsController } from './decision-ollama-models.controller';
import { DecisionOllamaModelsService } from './decision-ollama-models.service';
import { DecisionOllamaInstallService } from './decision-ollama-install.service';
import { DecisionOllamaModelsGuard } from './decision-ollama-models.guard';

@Global()
@Module({
  imports: [CredentialsModule],
  controllers: [DecisionAuthController, DecisionSettingsController, DecisionOllamaModelsController],
  providers: [{ provide: DECISION_SETTINGS, useClass: DecisionSettingsService },
    { provide: DecisionAuthService, useFactory: () => new DecisionAuthService() }, DecisionAuthGuard,
    DecisionOllamaModelsService, DecisionOllamaInstallService, DecisionOllamaModelsGuard],
  exports: [DECISION_SETTINGS, DecisionAuthService, DecisionAuthGuard],
})
export class DecisionSettingsModule {}
