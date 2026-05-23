import type { CLIAgentConfig } from '@kalio/types';

export type KalioHitlMode = 'manual' | 'auto' | 'bypass';
export type KalioSearchProvider = 'perplexity' | 'perplexity-openrouter';
export type KalioToolApprovalMode = 'auto' | 'prompt' | 'approve';

export interface KalioRuntimeConfig {
  context_window_size?: number;
  max_tool_attempts?: number;
  temperature?: number;
  max_tokens?: number;
}

export interface KalioToolTimeoutConfig {
  web_search_timeout_ms?: number;
  provider_local_timeout_ms?: number;
  provider_remote_timeout_ms?: number;
}

export interface KalioHitlConfig {
  mode?: KalioHitlMode;
  auto_persona_id?: string | null;
}

export interface KalioSearchConfig {
  provider?: KalioSearchProvider;
}

export interface KalioImageConfig {
  provider?: string;
  model?: string;
  base_url?: string;
  compression?: Record<string, unknown>;
}

export interface KalioMcpToolConfig {
  approval_mode?: KalioToolApprovalMode;
}

export interface KalioRemoteEnvVar {
  name: string;
  source: 'local' | 'remote';
}

export interface KalioMcpServerConfig {
  enabled?: boolean;
  required?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  env_vars?: Array<string | KalioRemoteEnvVar>;
  cwd?: string;
  experimental_environment?: 'local' | 'remote';
  url?: string;
  bearer_token_env_var?: string;
  http_headers?: Record<string, string>;
  env_http_headers?: Record<string, string>;
  enabled_tools?: string[];
  disabled_tools?: string[];
  default_tools_approval_mode?: KalioToolApprovalMode;
  tools?: Record<string, KalioMcpToolConfig>;
  startup_timeout_sec?: number;
  startup_timeout_ms?: number;
  tool_timeout_sec?: number;
  scopes?: string[];
  oauth_resource?: string;
}

export interface KalioConfig {
  features?: Record<string, boolean>;
  runtime?: KalioRuntimeConfig;
  tool_timeouts?: KalioToolTimeoutConfig;
  hitl?: KalioHitlConfig;
  search?: KalioSearchConfig;
  image?: KalioImageConfig;
  cli_agents?: Record<string, Partial<CLIAgentConfig>>;
  mcp_servers?: Record<string, KalioMcpServerConfig>;
}

export interface KalioConfigLayer {
  scope: 'user' | 'project';
  path: string;
  config: KalioConfig;
}

export interface KalioEffectiveConfig {
  config: KalioConfig;
  layers: KalioConfigLayer[];
}

export interface KalioConfigLoadOptions {
  cwd?: string;
  homeDir?: string;
  projectRootMarkers?: string[];
}