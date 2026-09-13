import { describe, expect, it } from 'vitest';
import { classifyDevinNativeTool } from './devin-native-tools';

describe('Devin native tool classification', () => {
  it('maps ACP tool kinds to the matching settings category', () => {
    expect(classifyDevinNativeTool({ kind: 'read', title: 'Read file' })).toBe('filesystem');
    expect(classifyDevinNativeTool({ kind: 'execute', title: 'Run command' })).toBe('terminal');
    expect(classifyDevinNativeTool({ kind: 'fetch', title: 'Fetch URL' })).toBe('web');
  });

  it('uses labels to distinguish web search from filesystem search', () => {
    expect(classifyDevinNativeTool({ kind: 'search', title: 'Search workspace files' })).toBe('filesystem');
    expect(classifyDevinNativeTool({ kind: 'search', title: 'Search the web' })).toBe('web');
  });

  it('fails closed for an unclassified tool', () => {
    expect(classifyDevinNativeTool({ kind: 'other', title: 'Unknown operation' })).toBeUndefined();
  });
});
