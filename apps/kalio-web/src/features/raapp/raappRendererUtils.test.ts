import { describe, expect, it } from 'vitest';
import {
  findHtmlInData,
  injectEngineCDN,
  isHtmlString,
  unescapeHtml,
} from './raappRendererUtils';

describe('raappRendererUtils', () => {
  it('detects HTML-looking strings after trimming leading whitespace', () => {
    expect(isHtmlString('   <div>hello</div>')).toBe(true);
    expect(isHtmlString('plain text')).toBe(false);
  });

  it('unescapes quoted payloads from tool output', () => {
    expect(unescapeHtml('"<div>hello\\nworld</div>"')).toBe('<div>hello\nworld</div>');
    expect(unescapeHtml("'line\\tvalue'")).toBe('line\tvalue');
  });

  it('finds HTML in direct strings, known fields, and long free-form values', () => {
    expect(findHtmlInData('<svg></svg>')).toBe('<svg></svg>');
    expect(findHtmlInData({ html: '"<div>embedded</div>"' })).toBe('<div>embedded</div>');
    expect(findHtmlInData({
      notes: 'x'.repeat(60),
      rendered: `<table><tr><td>${'ok'.repeat(30)}</td></tr></table>`,
    })).toBe(`<table><tr><td>${'ok'.repeat(30)}</td></tr></table>`);
    expect(findHtmlInData({ html: 'not html' })).toBeNull();
  });

  it('injects engine scripts before </head>, before <body>, or at the top as a fallback', () => {
    const withHead = injectEngineCDN('<html><head></head><body></body></html>', 'chartjs');
    const withBody = injectEngineCDN('<html><body></body></html>', 'p5');
    const fallback = injectEngineCDN('<div>bodyless</div>', 'tone');

    expect(withHead).toContain('chart.umd.min.js');
    expect(withHead.indexOf('chart.umd.min.js')).toBeLessThan(withHead.indexOf('</head>'));

    expect(withBody).toContain('p5.min.js');
    expect(withBody.indexOf('p5.min.js')).toBeLessThan(withBody.indexOf('<body'));

    expect(fallback.startsWith('<script src="https://cdn.jsdelivr.net/npm/tone@14.7.77/build/Tone.js"></script>')).toBe(true);
  });

  it('returns the original HTML when the engine is missing or unsupported', () => {
    const html = '<html><body>hello</body></html>';

    expect(injectEngineCDN(html)).toBe(html);
    expect(injectEngineCDN(html, 'unknown-engine')).toBe(html);
  });
});
