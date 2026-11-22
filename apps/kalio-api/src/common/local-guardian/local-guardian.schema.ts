import type { LocalGuardianVerdict } from './local-guardian.types';

export const LOCAL_GUARDIAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: ['allow', 'deny', 'ask_user'] },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

export function isGuardianRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** No fences, substring extraction, yes/no conversion, or generated scores. */
export function parseGuardianContent(content: unknown): {
  verdict: LocalGuardianVerdict; reason: string;
} | null {
  if (typeof content !== 'string' || content.length > 8192) return null;
  let value: unknown;
  try { value = JSON.parse(content) as unknown; } catch { return null; }
  if (!isGuardianRecord(value) || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'verdict') || !Object.hasOwn(value, 'reason')) return null;
  const { verdict, reason } = value;
  if ((verdict !== 'allow' && verdict !== 'deny' && verdict !== 'ask_user')
    || typeof reason !== 'string' || reason.length > 1000 || !reason.trim()) return null;
  return { verdict, reason: reason.trim() };
}
