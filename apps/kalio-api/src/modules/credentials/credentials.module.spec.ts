import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DatabaseModule } from '../../database/database.module';
import { CredentialsController } from './credentials.controller';
import { CredentialsModule } from './credentials.module';
import { LLMService } from '../llm/llm.service';
import { LLMModule } from '../llm/llm.module';

describe('CredentialsModule', () => {
  it('compiles the credentials and LLM modules together so the controller can inject LLMService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({
            LLM_PROVIDER: 'openai',
            LLM_API_KEY: 'mock',
            LLM_BASE_URL: 'mock',
            LLM_MODEL: 'mock',
          })],
        }),
        DatabaseModule,
        CredentialsModule,
        LLMModule,
      ],
    }).compile();

    expect(moduleRef.get(CredentialsController)).toBeInstanceOf(CredentialsController);
    expect(moduleRef.get(LLMService)).toBeInstanceOf(LLMService);
  });
});
