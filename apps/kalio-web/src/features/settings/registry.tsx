import type { ReactNode, ComponentType } from 'react';
import { Bot, Plug, Users } from 'lucide-react';
import { LLMPanel } from './LLMPanel';
import { MCPSettingsPanel } from './MCPSettingsPanel';
import { PersonasPanel } from './PersonasPanel';

export interface SettingsBlock {
  id: string;
  label: string;
  icon: ReactNode;
  component: ComponentType;
}

export const SETTINGS_BLOCKS: SettingsBlock[] = [
  { id: 'llm',      label: 'LLM Providers', icon: <Bot size={16} />,   component: LLMPanel },
  { id: 'mcp',      label: 'MCP Servers',   icon: <Plug size={16} />,  component: MCPSettingsPanel },
  { id: 'personas', label: 'Personas',      icon: <Users size={16} />, component: PersonasPanel },
];
