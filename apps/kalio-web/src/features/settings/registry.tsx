import type { ReactNode, ComponentType } from 'react';
import { Bot, Gauge, MessageSquareText, Plug, Folder, Database, Search, Wrench, Image, Send, ShieldAlert, DatabaseZap, ServerCog } from 'lucide-react';
import { LLMPanel } from './LLMPanel';
import { MCPSettingsPanel } from './MCPSettingsPanel';
import { AllowedPathsPanel } from './AllowedPathsPanel';
import { EmbeddingsPanel } from './EmbeddingsPanel';
import { WebSearchPanel } from './WebSearchPanel';
import { CLIAgentPanel } from './CLIAgentPanel';
import { ImageSettingsPanel } from './ImageSettingsPanel';
import { TelegramSettings } from './TelegramSettings';
import { HITLSettingsPanel } from './HITLSettingsPanel';
import { AuditRetentionSettingsPanel } from './AuditRetentionSettingsPanel';
import { ConversationSettingsPanel } from './ConversationSettingsPanel';
import { NativeCliIntegrationsPanel } from './NativeCliIntegrationsPanel';

export interface SettingsBlock {
  id: string;
  label: string;
  icon: ReactNode;
  component: ComponentType;
}

export const SETTINGS_BLOCKS: SettingsBlock[] = [
  { id: 'llm',          label: 'LLM Settings',     icon: <Bot size={16} />,      component: () => <LLMPanel mode="providers" /> },
  { id: 'runtime',      label: 'Runtime Settings', icon: <Gauge size={16} />,    component: () => <LLMPanel mode="runtime" /> },
  { id: 'conversation', label: 'Conversation',     icon: <MessageSquareText size={16} />, component: ConversationSettingsPanel },
  { id: 'hitl',         label: 'HITL Approvals',   icon: <ShieldAlert size={16} />, component: HITLSettingsPanel },
  { id: 'audit-retention', label: 'Audit Retention', icon: <DatabaseZap size={16} />, component: AuditRetentionSettingsPanel },
  { id: 'embeddings',   label: 'Embeddings',        icon: <Database size={16} />, component: EmbeddingsPanel },
  { id: 'web-search',   label: 'Web Search',        icon: <Search size={16} />,   component: WebSearchPanel },
  { id: 'image',        label: 'Image Generation',  icon: <Image size={16} />,    component: ImageSettingsPanel },
  { id: 'tools',        label: 'CLI Agents',        icon: <Wrench size={16} />,   component: CLIAgentPanel },
  { id: 'native-cli',   label: 'Native CLI integrations', icon: <ServerCog size={16} />, component: NativeCliIntegrationsPanel },
  { id: 'mcp',          label: 'MCP Servers',       icon: <Plug size={16} />,     component: MCPSettingsPanel },
  { id: 'allowed-paths', label: 'Allowed Paths',    icon: <Folder size={16} />,   component: AllowedPathsPanel },
  { id: 'telegram',     label: 'Telegram',          icon: <Send size={16} />,     component: TelegramSettings },
];
