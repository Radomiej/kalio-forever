import { describe, it, expect, vi } from 'vitest';
import type { RefObject } from 'react';
import {
  canReleaseComposerAfterToolResult,
  createToolArgProgressHandlers,
} from './useChatSocketEvents.helpers';

describe('useChatSocketEvents helpers', () => {
  const makeRef = (): RefObject<Record<string, Set<string>>> => ({ current: {} });

  it('markToolArgProgressSeen stores seen tool names per session', () => {
    const toolArgProgressSeenRef = makeRef();
    const setToolArgProgress = vi.fn();

    const { markToolArgProgressSeen } = createToolArgProgressHandlers({
      toolArgProgressSeenRef,
      setToolArgProgress,
      getActiveSessionId: () => 'session-1',
    });

    markToolArgProgressSeen('session-1', 'fs_list');
    markToolArgProgressSeen('session-1', 'vfs_read');

    expect(toolArgProgressSeenRef.current['session-1']).toEqual(new Set(['fs_list', 'vfs_read']));
  });

  it('ensureSyntheticToolIntent emits progress when active session has not seen tool', () => {
    const toolArgProgressSeenRef = makeRef();
    const setToolArgProgress = vi.fn();

    const { ensureSyntheticToolIntent } = createToolArgProgressHandlers({
      toolArgProgressSeenRef,
      setToolArgProgress,
      getActiveSessionId: () => 'session-1',
    });

    ensureSyntheticToolIntent('session-1', 'web_search');

    expect(setToolArgProgress).toHaveBeenCalledWith({ toolName: 'web_search', totalChars: 0, charsPerSec: 0 });
  });

  it('ensureSyntheticToolIntent does not emit synthetic progress when already seen', () => {
    const toolArgProgressSeenRef = makeRef();
    const setToolArgProgress = vi.fn();
    const { markToolArgProgressSeen, ensureSyntheticToolIntent } = createToolArgProgressHandlers({
      toolArgProgressSeenRef,
      setToolArgProgress,
      getActiveSessionId: () => 'session-1',
    });

    markToolArgProgressSeen('session-1', 'web_search');
    ensureSyntheticToolIntent('session-1', 'web_search');

    expect(setToolArgProgress).not.toHaveBeenCalled();
  });

  it('clearToolArgProgressTracking clears all sessions when no sessionId passed', () => {
    const toolArgProgressSeenRef = { current: { 'session-1': new Set(['web_search']), 'session-2': new Set(['fs_list']) } };
    const setToolArgProgress = vi.fn();

    const { clearToolArgProgressTracking } = createToolArgProgressHandlers({
      toolArgProgressSeenRef,
      setToolArgProgress,
      getActiveSessionId: () => 'session-1',
    });

    clearToolArgProgressTracking(null);

    expect(toolArgProgressSeenRef.current).toEqual({});
    expect(setToolArgProgress).toHaveBeenCalledWith(null);
  });

  it('clearToolArgProgressTracking clears only matching session and resets composer on active session', () => {
    const toolArgProgressSeenRef = { current: { 'session-1': new Set(['web_search']), 'session-2': new Set(['fs_list']) } };
    const setToolArgProgress = vi.fn();

    const { clearToolArgProgressTracking } = createToolArgProgressHandlers({
      toolArgProgressSeenRef,
      setToolArgProgress,
      getActiveSessionId: () => 'session-1',
    });

    clearToolArgProgressTracking('session-1');

    expect(toolArgProgressSeenRef.current).toEqual({ 'session-2': new Set(['fs_list']) });
    expect(setToolArgProgress).toHaveBeenCalledWith(null);
  });

  it('canReleaseComposerAfterToolResult allows release when no active turn', () => {
    expect(canReleaseComposerAfterToolResult({
      hasActiveTurn: false,
      hasActiveLoop: true,
      hasActiveTool: true,
      hasPendingChunks: true,
    })).toBe(true);
  });

  it('canReleaseComposerAfterToolResult blocks release when loop still active', () => {
    expect(canReleaseComposerAfterToolResult({
      hasActiveTurn: true,
      hasActiveLoop: true,
      hasActiveTool: false,
      hasPendingChunks: false,
    })).toBe(false);
  });

  it('canReleaseComposerAfterToolResult blocks release when tool still running', () => {
    expect(canReleaseComposerAfterToolResult({
      hasActiveTurn: true,
      hasActiveLoop: false,
      hasActiveTool: true,
      hasPendingChunks: false,
    })).toBe(false);
  });

  it('canReleaseComposerAfterToolResult blocks release when chunks are pending', () => {
    expect(canReleaseComposerAfterToolResult({
      hasActiveTurn: true,
      hasActiveLoop: false,
      hasActiveTool: false,
      hasPendingChunks: true,
    })).toBe(false);
  });
});
