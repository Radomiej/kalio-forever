import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { DatabaseModule } from '../../database/database.module';
import { CredentialsController } from './credentials.controller';
import { CredentialsModule } from './credentials.module';
import { LLMService } from '../llm/llm.service';
import { LLMModule } from '../llm/llm.module';
import { CredentialsRuntimeController } from '../llm/credentials-runtime.controller';

describe('CredentialsModule', () => {
  it('keeps LLM runtime smoke endpoints in LLMModule instead of importing LLMModule back into CredentialsModule', async () => {
    const credentialImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, CredentialsModule) as unknown[] | undefined;

    expect(credentialImports ?? []).not.toContain(LLMModule);

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
    expect(moduleRef.get(CredentialsRuntimeController)).toBeInstanceOf(CredentialsRuntimeController);
    expect(moduleRef.get(LLMService)).toBeInstanceOf(LLMService);
  });
});
