import type { ReactNode, ComponentType } from 'react';
import { Bot, Plug, Folder, Database, Search } from 'lucide-react';
import { LLMPanel } from './LLMPanel';
import { MCPSettingsPanel } from './MCPSettingsPanel';
import { AllowedPathsPanel } from './AllowedPathsPanel';
import { EmbeddingsPanel } from './EmbeddingsPanel';
import { WebSearchPanel } from './WebSearchPanel';

export interface SettingsBlock {
  id: string;
  label: string;
  icon: ReactNode;
  component: ComponentType;
}

export const SETTINGS_BLOCKS: SettingsBlock[] = [
  { id: 'llm',          label: 'LLM Providers',  icon: <Bot size={16} />,      component: LLMPanel },
  { id: 'embeddings',   label: 'Embeddings',      icon: <Database size={16} />, component: EmbeddingsPanel },
  { id: 'web-search',   label: 'Web Search',      icon: <Search size={16} />,   component: WebSearchPanel },
  { id: 'mcp',          label: 'MCP Servers',     icon: <Plug size={16} />,     component: MCPSettingsPanel },
  { id: 'allowed-paths', label: 'Allowed Paths',  icon: <Folder size={16} />,   component: AllowedPathsPanel },
];
