import { describe, expect, it } from 'vitest';
import { summarizeDevinToolOutput } from './devin-tool-output-summary';

describe('safe Devin output summary', () => {
  it('summarizes a failed permission message without persisting it', () => {
    const raw = { error: { message: 'Permission denied for secret-token and private/path' } };
    const summary = summarizeDevinToolOutput('failed', raw);
    expect(summary).toEqual({ outputPresent: true, permissionMentionedInFailure: true });
    expect(JSON.stringify(summary)).not.toContain('secret-token');
    expect(JSON.stringify(summary)).not.toContain('private/path');
  });
  it('does not label successful content or an unknown failure as a permission denial', () => {
    expect(summarizeDevinToolOutput('completed', 'permission denied')).toEqual({ outputPresent: true, permissionMentionedInFailure: false });
    expect(summarizeDevinToolOutput('failed', 'file not found')).toEqual({ outputPresent: true, permissionMentionedInFailure: false });
  });
  it('reads ACP text error content but never serializes file diffs', () => {
    expect(summarizeDevinToolOutput('failed', undefined, [{ type: 'content', content: { type: 'text', text: 'Tool not allowed by permissions' } }]))
      .toEqual({ outputPresent: true, permissionMentionedInFailure: true });
    expect(summarizeDevinToolOutput('failed', undefined, [{ type: 'diff', path: 'private', oldText: 'Permission denied', newText: 'private data' }]))
      .toEqual({ outputPresent: true, permissionMentionedInFailure: false });
  });
});
