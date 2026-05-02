import type { ReactNode, ComponentType } from 'react';
import { Bot, Plug, Folder, Database, Search, Wrench, Image } from 'lucide-react';
import { LLMPanel } from './LLMPanel';
import { MCPSettingsPanel } from './MCPSettingsPanel';
import { AllowedPathsPanel } from './AllowedPathsPanel';
import { EmbeddingsPanel } from './EmbeddingsPanel';
import { WebSearchPanel } from './WebSearchPanel';
import { CLIAgentPanel } from './CLIAgentPanel';
import { ImageSettingsPanel } from './ImageSettingsPanel';

export interface SettingsBlock {
  id: string;
  label: string;
  icon: ReactNode;
  component: ComponentType;
}

export const SETTINGS_BLOCKS: SettingsBlock[] = [
  { id: 'llm',          label: 'LLM Providers',    icon: <Bot size={16} />,      component: LLMPanel },
  { id: 'embeddings',   label: 'Embeddings',        icon: <Database size={16} />, component: EmbeddingsPanel },
  { id: 'web-search',   label: 'Web Search',        icon: <Search size={16} />,   component: WebSearchPanel },
  { id: 'image',        label: 'Image Generation',  icon: <Image size={16} />,    component: ImageSettingsPanel },
  { id: 'tools',        label: 'CLI Agents',        icon: <Wrench size={16} />,   component: CLIAgentPanel },
  { id: 'mcp',          label: 'MCP Servers',       icon: <Plug size={16} />,     component: MCPSettingsPanel },
  { id: 'allowed-paths', label: 'Allowed Paths',    icon: <Folder size={16} />,   component: AllowedPathsPanel },
];
