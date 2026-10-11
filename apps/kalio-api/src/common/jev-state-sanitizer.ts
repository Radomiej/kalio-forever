const SECRET_FIELD_PATTERN = /(?:api.?key|access.?key|private.?key|signing.?key|ssh.?key|token|secret|password|credential|authorization)/i;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /--(?:api[-_]?key|access[-_]?key|private[-_]?key|signing[-_]?key|ssh[-_]?key|token|secret(?:[-_][A-Za-z0-9]+)*|password)(?:=|\s+)["']?[^\s"'`]+/gi,
  /\b[A-Za-z_][A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\s*=\s*["']?[^;\s"'`]+/gi,
  /\bauthorization\s*:\s*[^;\r\n]+/gi,
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@\s:]+(?::[^/@\s]*)?@/g,
  /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
];

export function sanitizeJevState(value: Record<string, unknown>, maxCharacters = 12_000,
  limits?: { maxStringCharacters: number }): Record<string, unknown> {
  const maxStringCharacters = limits === undefined ? 2_000 : limits?.maxStringCharacters;
  if (typeof maxStringCharacters !== 'number' || !Number.isSafeInteger(maxStringCharacters)
    || maxStringCharacters < 1 || maxStringCharacters > 65_536) {
    throw new Error('Invalid Jev sanitizer limits.');
  }
  const sanitized = sanitizeValue(value, 0, maxStringCharacters);
  let serialized: string;
  try {
    serialized = JSON.stringify(sanitized);
  } catch {
    return { state: '[UNSERIALIZABLE]' };
  }
  if (serialized.length <= maxCharacters) return sanitized as Record<string, unknown>;
  let truncatedState = serialized;
  let result = { truncatedState };
  while (JSON.stringify(result).length > maxCharacters && truncatedState.length > 0) {
    truncatedState = truncatedState.slice(0, Math.max(0, truncatedState.length - 100));
    result = { truncatedState };
  }
  return result;
}

function sanitizeValue(value: unknown, depth: number, maxStringCharacters: number, key?: string): unknown {
  if (key && SECRET_FIELD_PATTERN.test(key)) return '[REDACTED]';
  if (depth >= 6) return '[TRUNCATED]';
  if (typeof value === 'string') return redactSecretValues(value).slice(0, maxStringCharacters);
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeValue(entry, depth + 1, maxStringCharacters));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .slice(0, 50)
    .map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, depth + 1, maxStringCharacters, entryKey)]));
}

function redactSecretValues(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce((redacted, pattern) => redacted.replace(pattern, '[REDACTED]'), value);
}
