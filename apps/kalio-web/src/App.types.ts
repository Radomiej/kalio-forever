export type ActiveSection = 'landing' | 'talk' | 'tools' | 'mind' | 'observe' | 'architect';
export type TalkTab = 'conversations' | 'agents';
export type TalkView = 'conversation' | 'graph';
export type ToolsTab = 'native' | 'mcp' | 'raapps';
export type MindTab = 'memory' | 'files' | 'skills' | 'personas';

export type AppViewState = {
  activeSection: ActiveSection;
  talkTab: TalkTab;
  talkView: TalkView;
  toolsTab: ToolsTab;
  mindTab: MindTab;
  selectedSkillId: string | null;
};
