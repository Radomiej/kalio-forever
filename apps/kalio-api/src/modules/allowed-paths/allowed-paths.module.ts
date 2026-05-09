import { Module } from '@nestjs/common';
import { AllowedPathsService } from './allowed-paths.service';
import { AllowedPathsController } from './allowed-paths.controller';

@Module({
  providers: [AllowedPathsService],
  controllers: [AllowedPathsController],
  exports: [AllowedPathsService],
})
export class AllowedPathsModule {}
