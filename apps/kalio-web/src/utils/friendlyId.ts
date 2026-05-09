/**
 * Deterministic friendly-name generator for opaque IDs.
 *
 * Same ID always produces the same adjective_noun pair.
 * Uses FNV-1a 32-bit hash for fast, stable mapping.
 *
 * Example: "QxXITvX6eqkAbs1X1W3Md" → "swift_fox"
 */

const ADJECTIVES = [
  'amber', 'ancient', 'autumn', 'azure', 'blazing', 'bold', 'brave', 'bright',
  'calm', 'clever', 'cool', 'cosmic', 'crisp', 'crystal', 'daring', 'dark',
  'dawn', 'deft', 'eager', 'early', 'epic', 'fancy', 'fast', 'fierce',
  'firm', 'fresh', 'frosty', 'glad', 'gold', 'grand', 'green', 'happy',
  'hardy', 'hidden', 'hollow', 'honest', 'iron', 'jade', 'keen', 'kind',
  'late', 'lively', 'lone', 'lucky', 'lunar', 'merry', 'mighty', 'mint',
  'misty', 'noble', 'north', 'odd', 'old', 'pale', 'plain', 'prime',
  'proud', 'quick', 'quiet', 'rapid', 'raw', 'red', 'rich', 'ripe',
  'royal', 'rusty', 'sage', 'sandy', 'sharp', 'shiny', 'silent', 'silver',
  'sleek', 'slim', 'smart', 'snappy', 'soft', 'solid', 'solar', 'steel',
  'still', 'stone', 'sturdy', 'sunny', 'super', 'swift', 'tidy', 'tiny',
  'tough', 'true', 'vivid', 'warm', 'wild', 'wise', 'witty', 'young',
] as const;

const NOUNS = [
  'badger', 'bear', 'beetle', 'bison', 'boar', 'buck', 'bull', 'carp',
  'cat', 'cobra', 'colt', 'crab', 'crane', 'crow', 'deer', 'dove',
  'drake', 'duck', 'eagle', 'elk', 'falcon', 'fawn', 'ferret', 'finch',
  'fish', 'fox', 'frog', 'goat', 'goose', 'hawk', 'heron', 'horse',
  'hound', 'ibex', 'jackal', 'jay', 'kite', 'kiwi', 'lamb', 'lark',
  'lemur', 'leopard', 'lion', 'lynx', 'mare', 'mink', 'mole', 'moose',
  'moth', 'mule', 'newt', 'otter', 'owl', 'panther', 'parrot', 'pony',
  'puma', 'quail', 'raven', 'robin', 'salmon', 'seal', 'shark', 'skunk',
  'slug', 'snail', 'snake', 'sparrow', 'stag', 'stork', 'swan', 'tiger',
  'toad', 'trout', 'vole', 'wasp', 'weasel', 'whale', 'wolf', 'wren',
  'yak', 'zebra', 'ant', 'bee', 'gnu', 'hen', 'hog', 'koi',
  'ram', 'rat', 'ray', 'doe', 'ewe', 'fly', 'jay', 'kit',
] as const;

/** FNV-1a 32-bit hash — fast and stable across JS engines. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // Unsigned 32-bit multiply
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Maps any string ID to a deterministic "adjective_noun" label.
 * The same input always produces the same output.
 */
export function toFriendlyName(id: string): string {
  if (!id) return 'unknown_id';
  const hash = fnv1a(id);
  const adj = ADJECTIVES[hash % ADJECTIVES.length];
  // Use bits 8-16 for the noun to avoid correlation with the adjective pick
  const noun = NOUNS[(hash >>> 8) % NOUNS.length];
  return `${adj}_${noun}`;
}
