import { describe, expect, it } from 'vitest';
import { toDynamicToolResponse } from './codex-dynamic-tools';

describe('Codex dynamic result boundaries', () => {
  it.each(['error', 'cancelled'] as const)('preserves %s and never sends file content as a success', status => {
    expect(toDynamicToolResponse({ status, errorMessage: 'Read denied', data: { content: '# private' } }, 'fs_read'))
      .toEqual({ success: false, contentItems: [{ type: 'inputText', text: 'Read denied' }] });
  });

  it('keeps structured results for other tools, even when they have a content property', () => {
    const data = { content: 'not a file', entries: [] };
    expect(toDynamicToolResponse({ status: 'success', data }, 'fs_list'))
      .toEqual({ success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(data) }] });
  });

  it('preserves non-text results instead of coercing or silently discarding them', () => {
    expect(toDynamicToolResponse({ status: 'success', data: { content: null } }, 'fs_read'))
      .toEqual({ success: true, contentItems: [{ type: 'inputText', text: '{"content":null}' }] });
  });

  it('keeps image metadata and image bytes', () => {
    const imageUrl = 'data:image/png;base64,aGVsbG8=';
    expect(toDynamicToolResponse({ status: 'success', data: { output_type: 'image', image_url: imageUrl } }, 'image_view'))
      .toEqual({ success: true, contentItems: [
        { type: 'inputText', text: '{"output_type":"image"}' }, { type: 'inputImage', imageUrl },
      ] });
  });
});
