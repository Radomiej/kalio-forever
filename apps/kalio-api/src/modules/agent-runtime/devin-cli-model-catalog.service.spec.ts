import { describe, expect, it } from 'vitest';
import { parseDevinCliModelCatalog } from './devin-cli-model-catalog.service';

describe('parseDevinCliModelCatalog', () => {
  it('reads family slugs and exact model ids, including current Devin model lanes', () => {
    const output = [
      '\u001b[1mAvailable models (2 families)\u001b[0m',
      'GLM-5.2 (glm-5.2)',
      '  glm-5-2                                                                  GLM-5.2 High [Free]',
      'SWE-2 (swe-2)',
      '  aliases: swe',
      '  swe-2-high                                                              SWE-2 High [Free]',
      '  swe-2-medium                                                            SWE-2 Medium [Free]',
      '  swe-2-max                                                               SWE-2 Max [Free]',
      'Fusion (fusion-gpt-6-sol-high-sidekick-swe-2-medium)',
      '  fusion-gpt-6-sol-high-sidekick-swe-2-medium                             Fusion (GPT-6 Sol + SWE-2 Medium)',
      'malformed model line with spaces',
    ].join('\r\n');

    expect(parseDevinCliModelCatalog(output)).toEqual([
      'glm-5.2', 'glm-5-2', 'swe-2', 'swe-2-high', 'swe-2-medium', 'swe-2-max',
      'fusion-gpt-6-sol-high-sidekick-swe-2-medium',
    ]);
  });

  it('rejects control characters and returns no identifiers for unrecognized output', () => {
    expect(parseDevinCliModelCatalog('  bad\u0000model  description\nno model entries')).toEqual([]);
  });
});
