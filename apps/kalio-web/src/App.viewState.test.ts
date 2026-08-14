import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APP_VIEW_STATE_STORAGE_KEY,
  DEFAULT_APP_VIEW_STATE,
  LAST_TALK_ACTIVE_STORAGE_KEY,
  TALK_GROUPING_STORAGE_KEY,
  TALK_VIEW_STORAGE_KEY,
  loadAppViewState,
  loadLastTalkActiveAt,
  loadTalkGroupingPreference,
  loadTalkViewPreference,
  persistTalkGroupingPreference,
  persistTalkViewPreference,
  recentTalkBadgeCount,
} from './App.viewState';

describe('App view state persistence', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('loads defaults when no view state is stored', () => {
    expect(loadAppViewState()).toEqual(DEFAULT_APP_VIEW_STATE);
    expect(loadTalkViewPreference()).toBe('conversation');
    expect(loadTalkGroupingPreference()).toBe('project');
    expect(loadLastTalkActiveAt()).toBeNull();
  });

  it('normalizes valid and invalid persisted view values', () => {
    window.sessionStorage.setItem(APP_VIEW_STATE_STORAGE_KEY, JSON.stringify({
      activeSection: 'observe',
      talkTab: 'agents',
      talkView: 'graph',
      toolsTab: 'mcp',
      mindTab: 'skills',
      selectedSkillId: 'skill-1',
    }));

    expect(loadAppViewState()).toEqual({
      activeSection: 'observe',
      talkTab: 'agents',
      talkView: 'graph',
      toolsTab: 'mcp',
      mindTab: 'skills',
      selectedSkillId: 'skill-1',
    });

    window.sessionStorage.setItem(APP_VIEW_STATE_STORAGE_KEY, JSON.stringify({
      activeSection: 'unknown',
      talkTab: 'unknown',
      talkView: 'unknown',
      toolsTab: 'unknown',
      mindTab: 'unknown',
      selectedSkillId: 42,
    }));

    expect(loadAppViewState()).toEqual(DEFAULT_APP_VIEW_STATE);
  });

  it('falls back after malformed persisted state', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.sessionStorage.setItem(APP_VIEW_STATE_STORAGE_KEY, '{malformed');

    expect(loadAppViewState()).toEqual(DEFAULT_APP_VIEW_STATE);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('persists and validates talk preferences', () => {
    persistTalkViewPreference('graph');
    persistTalkGroupingPreference('history');
    expect(window.localStorage.getItem(TALK_VIEW_STORAGE_KEY)).toBe('graph');
    expect(window.localStorage.getItem(TALK_GROUPING_STORAGE_KEY)).toBe('history');
    expect(loadTalkViewPreference()).toBe('graph');
    expect(loadTalkGroupingPreference()).toBe('history');

    window.localStorage.setItem(TALK_VIEW_STORAGE_KEY, 'invalid');
    window.localStorage.setItem(TALK_GROUPING_STORAGE_KEY, 'invalid');
    expect(loadTalkViewPreference()).toBe('conversation');
    expect(loadTalkGroupingPreference()).toBe('project');
  });

  it('parses recent activity and ignores invalid timestamps', () => {
    window.localStorage.setItem(LAST_TALK_ACTIVE_STORAGE_KEY, '123');
    expect(loadLastTalkActiveAt()).toBe(123);

    window.localStorage.setItem(LAST_TALK_ACTIVE_STORAGE_KEY, '0');
    expect(loadLastTalkActiveAt()).toBeNull();
    window.localStorage.setItem(LAST_TALK_ACTIVE_STORAGE_KEY, 'not-a-number');
    expect(loadLastTalkActiveAt()).toBeNull();

    expect(recentTalkBadgeCount([{ updatedAt: 11 }, { updatedAt: 21 }], 10)).toBe(2);
    expect(recentTalkBadgeCount([{ updatedAt: 11 }, { updatedAt: 21 }], null, 86_400_021)).toBe(0);
  });
});
