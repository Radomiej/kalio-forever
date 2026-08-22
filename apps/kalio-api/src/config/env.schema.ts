import Joi from 'joi';

export const envSchema = Joi.object({
  PORT:                Joi.number().default(3016),
  KALIO_HOST:          Joi.string().optional(),
  KALIO_INSTALL_PROFILE: Joi.string().optional(),
  KALIO_SERVE_UI:      Joi.boolean().default(false),
  KALIO_WEB_ROOT:      Joi.string().optional(),
  KALIO_HOME:          Joi.string().optional(),
  KALIO_DATA_ROOT:     Joi.string().optional(),
  KALIO_CODEX_INHERIT_MCP: Joi.boolean().default(false),
  KALIO_MCP_BRIDGE_TOKEN: Joi.string().min(1).optional(),
  KALIO_SQLITE_DRIVER: Joi.string().valid('auto', 'node', 'bun').default('auto'),
  KALIO_RUNTIME_VERSION: Joi.string().optional(),
  KALIO_API_PROTOCOL_VERSION: Joi.string().default('1'),
  KALIO_DATABASE_SCHEMA_VERSION: Joi.string().default('1'),
  NODE_ENV:            Joi.string().valid('development', 'test', 'production').default('development'),
  DATABASE_PATH:       Joi.string().required(),
  WORKSPACE_ROOT:      Joi.string().required(),
  MEMORY_DB_PATH:      Joi.string().default('./data/memory'),
  EMBEDDING_ENABLED:   Joi.boolean().default(true),
  EMBEDDING_MODEL:     Joi.string().default('Xenova/multilingual-e5-small'),
  EMBEDDING_DIMENSIONS: Joi.number().default(384),
  EMBEDDING_CACHE_DIR: Joi.string().default('./data/embeddings-cache'),
  EMBEDDING_BACKEND:   Joi.string().valid('auto', 'webgpu', 'cpu').default('cpu'),
  // Dedicated embedding provider (optional — falls back to LLM config if not set)
  EMBEDDING_BASE_URL:  Joi.string().optional(),
  EMBEDDING_API_KEY:   Joi.string().optional(),
  KALIO_ENABLE_TEST_SUPPORT: Joi.boolean().default(false),
  // Web search (Perplexity) — optional, can be configured via Settings UI
  PERPLEXITY_API_KEY:  Joi.string().optional(),
  PERPLEXITY_PROVIDER: Joi.string().valid('perplexity', 'perplexity-openrouter').optional(),
  CREDENTIALS_MASTER_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
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
