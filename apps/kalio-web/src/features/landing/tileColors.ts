/** Metro-style tile color palette — deterministic color from app id */

const METRO_PALETTE = [
  { bg: '#0050ef', text: '#ffffff' }, // cobalt
  { bg: '#d80073', text: '#ffffff' }, // magenta
  { bg: '#a4c400', text: '#1a1a1a' }, // lime
  { bg: '#00aba9', text: '#ffffff' }, // teal
  { bg: '#fa6800', text: '#ffffff' }, // orange
  { bg: '#a20025', text: '#ffffff' }, // crimson
  { bg: '#aa00ff', text: '#ffffff' }, // violet
  { bg: '#60a917', text: '#ffffff' }, // emerald
  { bg: '#e3c800', text: '#1a1a1a' }, // yellow
  { bg: '#1ba1e2', text: '#ffffff' }, // cyan
  { bg: '#f0a30a', text: '#1a1a1a' }, // amber
  { bg: '#6d8764', text: '#ffffff' }, // olive
  { bg: '#e51400', text: '#ffffff' }, // red
  { bg: '#647687', text: '#ffffff' }, // steel
  { bg: '#76608a', text: '#ffffff' }, // mauve
] as const;

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function tileColorFromId(id: string): { bg: string; text: string } {
  const index = hashString(id) % METRO_PALETTE.length;
  return METRO_PALETTE[index];
}

/** Assign tile sizes for visual variety — every 3rd tile is wide (2x1) */
export function tileSizeForIndex(index: number): 'small' | 'wide' {
  return index % 5 === 2 ? 'wide' : 'small';
}
