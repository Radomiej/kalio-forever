export function resolveQaEnvValues({
  fileEnv,
  processEnv,
  useEnvLlm,
  forceEnvLlm,
  provider,
  apiKey,
  baseUrl,
  model,
}) {
  const llmEnv = useEnvLlm ? { ...fileEnv, ...processEnv } : {};
  const fallback = useEnvLlm ? '' : 'mock';
  const resolvedProvider = provider ?? llmEnv.LLM_PROVIDER ?? fallback;

  return {
    ...processEnv,
    ...fileEnv,
    LLM_PROVIDER: resolvedProvider,
    LLM_API_KEY: apiKey ?? llmEnv.LLM_API_KEY ?? fallback,
    LLM_BASE_URL: baseUrl ?? llmEnv.LLM_BASE_URL ?? fallback,
    LLM_MODEL: model ?? llmEnv.LLM_MODEL ?? fallback,
    KALIO_FORCE_ENV_LLM: forceEnvLlm ? '1' : (processEnv.KALIO_FORCE_ENV_LLM ?? fileEnv.KALIO_FORCE_ENV_LLM ?? ''),
    KALIO_MOCK_LLM_FAST: resolvedProvider === 'mock'
      ? '1'
      : (processEnv.KALIO_MOCK_LLM_FAST ?? fileEnv.KALIO_MOCK_LLM_FAST ?? ''),
  };
}
