import type { CSSProperties } from 'react';
import type { PersonaAvatarToken } from '@kalio/types';
import { resolveAvatarColors } from './persona-avatar.utils';

interface Props {
  token: PersonaAvatarToken;
  size?: number;
}

interface ShapeSeed {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (const char of seed) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededValue(base: number, offset: number, modulo: number): number {
  return (Math.abs(base + offset * 2654435761) % modulo);
}

function shapeSeeds(seed: string, colors: string[]): ShapeSeed[] {
  const hash = hashSeed(seed);
  return Array.from({ length: 6 }, (_, index) => ({
    x: 8 + seededValue(hash, index + 1, 72),
    y: 8 + seededValue(hash, index + 11, 72),
    w: 12 + seededValue(hash, index + 21, 24),
    h: 12 + seededValue(hash, index + 31, 24),
    color: colors[index % colors.length] ?? colors[0] ?? '#94a3b8',
  }));
}

function renderVariant(token: PersonaAvatarToken, colors: string[]) {
  const seeds = shapeSeeds(token.avatarSeed, colors);
  const primary = colors[0] ?? '#0f172a';
  const secondary = colors[1] ?? '#334155';
  const tertiary = colors[2] ?? '#94a3b8';
  const quaternary = colors[3] ?? '#cbd5e1';
  const accent = colors[4] ?? '#f8fafc';

  switch (token.avatarVariant) {
    case 'beam':
      return (
        <>
          <rect width="100" height="100" rx="50" fill={primary} />
          {seeds.slice(0, 4).map((seed, index) => (
            <rect
              key={`beam-${index}`}
              x={index * 25}
              y="0"
              width="25"
              height="100"
              fill={seed.color}
              opacity={0.72}
            />
          ))}
          <circle cx="50" cy="50" r="18" fill={accent} opacity={0.18} />
        </>
      );
    case 'pixel':
      return (
        <>
          <rect width="100" height="100" rx="50" fill={primary} />
          {Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, col) => {
            const fill = colors[(row + col + hashSeed(token.avatarSeed)) % colors.length] ?? accent;
            return (
              <rect
                key={`pixel-${row}-${col}`}
                x={14 + col * 14}
                y={14 + row * 14}
                width="10"
                height="10"
                rx="2"
                fill={fill}
                opacity={0.9}
              />
            );
          }))}
        </>
      );
    case 'sunset':
      return (
        <>
          <rect width="100" height="100" rx="50" fill={secondary} />
          <rect x="0" y="0" width="100" height="28" fill={primary} opacity={0.95} />
          <rect x="0" y="28" width="100" height="18" fill={secondary} opacity={0.95} />
          <rect x="0" y="46" width="100" height="18" fill={tertiary} opacity={0.95} />
          <rect x="0" y="64" width="100" height="18" fill={quaternary} opacity={0.95} />
          <rect x="0" y="82" width="100" height="18" fill={accent} opacity={0.95} />
          <circle cx="50" cy="47" r="16" fill={accent} opacity={0.4} />
        </>
      );
    case 'ring':
      return (
        <>
          <rect width="100" height="100" rx="50" fill={primary} />
          <circle cx="50" cy="50" r="34" fill="none" stroke={secondary} strokeWidth="12" opacity={0.9} />
          <circle cx="50" cy="50" r="20" fill="none" stroke={tertiary} strokeWidth="10" opacity={0.9} />
          <circle cx="50" cy="50" r="8" fill={accent} opacity={0.9} />
        </>
      );
    case 'bauhaus':
      return (
        <>
          <rect width="100" height="100" rx="50" fill={accent} />
          <rect x="10" y="10" width="38" height="38" fill={primary} opacity={0.9} />
          <rect x="52" y="14" width="34" height="20" fill={secondary} opacity={0.9} />
          <rect x="52" y="38" width="20" height="44" fill={tertiary} opacity={0.88} />
          <circle cx="34" cy="68" r="18" fill={quaternary} opacity={0.95} />
          <circle cx="74" cy="72" r="12" fill={primary} opacity={0.82} />
        </>
      );
    case 'marble':
    default:
      return (
        <>
          <rect width="100" height="100" rx="50" fill={primary} />
          {seeds.map((seed, index) => (
            <ellipse
              key={`marble-${index}`}
              cx={seed.x}
              cy={seed.y}
              rx={seed.w / 2}
              ry={seed.h / 2}
              fill={seed.color}
              opacity={0.52 + (index % 3) * 0.12}
            />
          ))}
          <path
            d="M15 60 C 28 40, 42 72, 58 46 S 82 34, 86 58"
            fill="none"
            stroke={accent}
            strokeWidth="7"
            strokeLinecap="round"
            opacity={0.24}
          />
        </>
      );
  }
}

export function PersonaAvatar({ token, size = 40 }: Props) {
  const colors = resolveAvatarColors(token.avatarPaletteKey);
  const style: CSSProperties = { width: size, height: size };

  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={`Avatar ${token.avatarVariant}`}
      data-testid="persona-avatar"
      style={style}
      className="shrink-0 overflow-hidden rounded-full"
    >
      {renderVariant(token, colors)}
    </svg>
  );
}
