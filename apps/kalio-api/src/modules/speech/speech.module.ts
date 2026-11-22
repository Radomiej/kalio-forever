import { Module } from '@nestjs/common';
import { VFSModule } from '../vfs/vfs.module';
import { SpeechAuthGuard } from './speech-auth.guard';
import { SpeechController } from './speech.controller';
import { SpeechInstallService } from './speech-install.service';
import { SpeechInferenceService } from './speech-inference.service';

@Module({
  imports: [VFSModule],
  controllers: [SpeechController],
  providers: [SpeechAuthGuard, SpeechInstallService, SpeechInferenceService],
})
export class SpeechModule {}
