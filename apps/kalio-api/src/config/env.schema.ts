import Joi from 'joi';

export const envSchema = Joi.object({
  PORT:                Joi.number().default(3016),
  NODE_ENV:            Joi.string().valid('development', 'test', 'production').default('development'),
  DATABASE_PATH:       Joi.string().required(),
  WORKSPACE_ROOT:      Joi.string().required(),
  MEMORY_DB_PATH:      Joi.string().default('./data/memory'),
  EMBEDDING_MODEL:     Joi.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: Joi.number().default(1536),
  LLM_API_KEY:         Joi.string().when('NODE_ENV', {
    is: 'test',
    then: Joi.string().optional().default('mock'),
    otherwise: Joi.string().required(),
  }),
  LLM_BASE_URL:        Joi.string().when('NODE_ENV', {
    is: 'test',
    then: Joi.string().optional().default('mock'),
    otherwise: Joi.string().required(),
  }),
  LLM_MODEL:           Joi.string().when('NODE_ENV', {
    is: 'test',
    then: Joi.string().optional().default('mock'),
    otherwise: Joi.string().required(),
  }),
}).unknown(true);
