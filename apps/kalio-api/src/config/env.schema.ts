import Joi from 'joi';

export const envSchema = Joi.object({
  PORT:           Joi.number().default(3015),
  NODE_ENV:       Joi.string().valid('development', 'test', 'production').default('development'),
  DATABASE_PATH:  Joi.string().required(),
  WORKSPACE_ROOT: Joi.string().required(),
  LLM_API_KEY:    Joi.string().when('NODE_ENV', {
    is: 'test',
    then: Joi.string().optional().default('mock'),
    otherwise: Joi.string().required(),
  }),
  LLM_BASE_URL:   Joi.string().when('NODE_ENV', {
    is: 'test',
    then: Joi.string().optional().default('mock'),
    otherwise: Joi.string().required(),
  }),
  LLM_MODEL:      Joi.string().when('NODE_ENV', {
    is: 'test',
    then: Joi.string().optional().default('mock'),
    otherwise: Joi.string().required(),
  }),
}).unknown(true);
