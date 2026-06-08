import type { ActiveSection, AppViewState, MindTab, TalkTab, TalkView, ToolsTab } from './App.types';

export const APP_VIEW_STATE_STORAGE_KEY = 'kalio:app-view-state';
export const LAST_TALK_ACTIVE_STORAGE_KEY = 'kalio:last-talk-active-at';
const RECENT_CHAT_FALLBACK_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_APP_VIEW_STATE: AppViewState = {
  activeSection: 'landing',
  talkTab: 'conversations',
  talkView: 'conversation',
  toolsTab: 'native',
  mindTab: 'memory',
  selectedSkillId: null,
};

function isActiveSection(value: unknown): value is ActiveSection {
  return value === 'landing'
    || value === 'talk'
    || value === 'tools'
    || value === 'mind'
    || value === 'observe'
    || value === 'architect';
}

function isTalkTab(value: unknown): value is TalkTab {
  return value === 'conversations' || value === 'agents';
}

function isTalkView(value: unknown): value is TalkView {
  return value === 'conversation' || value === 'graph';
}

function isToolsTab(value: unknown): value is ToolsTab {
  return value === 'native' || value === 'mcp' || value === 'raapps';
}

function isMindTab(value: unknown): value is MindTab {
  return value === 'memory' || value === 'files' || value === 'skills' || value === 'personas';
}

export function loadAppViewState(): AppViewState {
  if (typeof window === 'undefined') {
    return DEFAULT_APP_VIEW_STATE;
  }

  try {
    const raw = window.sessionStorage.getItem(APP_VIEW_STATE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_APP_VIEW_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<AppViewState>;
    return {
      activeSection: isActiveSection(parsed.activeSection) ? parsed.activeSection : DEFAULT_APP_VIEW_STATE.activeSection,
      talkTab: isTalkTab(parsed.talkTab) ? parsed.talkTab : DEFAULT_APP_VIEW_STATE.talkTab,
      talkView: isTalkView(parsed.talkView) ? parsed.talkView : DEFAULT_APP_VIEW_STATE.talkView,
      toolsTab: isToolsTab(parsed.toolsTab) ? parsed.toolsTab : DEFAULT_APP_VIEW_STATE.toolsTab,
      mindTab: isMindTab(parsed.mindTab) ? parsed.mindTab : DEFAULT_APP_VIEW_STATE.mindTab,
      selectedSkillId: typeof parsed.selectedSkillId === 'string' ? parsed.selectedSkillId : null,
    };
  } catch (err) {
    console.warn('[App] Failed to parse persisted view state', err);
    return DEFAULT_APP_VIEW_STATE;
  }
}

export function loadLastTalkActiveAt(): number | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(LAST_TALK_ACTIVE_STORAGE_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function recentTalkBadgeCount(sessions: { updatedAt: number }[], lastTalkActiveAt: number | null, now = Date.now()): number {
  const threshold = lastTalkActiveAt ?? now - RECENT_CHAT_FALLBACK_MS;
  return sessions.filter((session) => session.updatedAt > threshold).length;
}
