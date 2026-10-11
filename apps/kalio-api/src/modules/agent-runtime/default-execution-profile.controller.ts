import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { DefaultExecutionProfileService } from './default-execution-profile.service';
import { DecisionAuthGuard } from '../../common/decision-auth.guard';

@Controller('runtime/default-profile')
export class DefaultExecutionProfileController {
  constructor(private readonly defaults: DefaultExecutionProfileService) {}

  @Get()
  @UseGuards(DecisionAuthGuard)
  async get() {
    return { executionProfileId: await this.defaults.getId() };
  }

  @Put()
  @UseGuards(DecisionAuthGuard)
  select(@Body() input: unknown) {
    if (!input || typeof input !== 'object' || !('executionProfileId' in input)
      || typeof input.executionProfileId !== 'string'
      || Object.keys(input).some((key) => key !== 'executionProfileId')) {
      throw new BadRequestException('An execution profile is required.');
    }
    return this.defaults.select(input.executionProfileId);
  }
}
