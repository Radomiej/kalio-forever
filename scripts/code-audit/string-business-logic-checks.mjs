const STRING_BUSINESS_LOGIC_RULES = [
  {
    check: 'normalized-error-message-branch',
    severity: 'HIGH',
    pattern: /\b(?:error|err|cause|reason|detail|details)\b[^\r\n;]{0,160}\.message\b[^\r\n;]{0,120}toLowerCase\s*\(\s*\)\s*\.\s*includes\s*\(/,
  },
  {
    check: 'error-message-branch',
    severity: 'HIGH',
    pattern: /\b(?:error|err|cause|reason|detail|details)\b[^\r\n;]{0,160}\.message\b[^\r\n;]{0,120}(?:===|!==|includes\s*\(|startsWith\s*\(|endsWith\s*\(|match\s*\()/,
  },
  {
    check: 'normalized-message-text-branch',
    severity: 'HIGH',
    pattern: /\bmessage\s*\.\s*toLowerCase\s*\(\s*\)\s*(?:===|!==|\.\s*(?:includes|startsWith|endsWith|match)\s*\()|\b(?:errorMessage|failureMessage|statusMessage)\b[^\r\n;]{0,120}toLowerCase\s*\(\s*\)\s*(?:===|!==|\.\s*(?:includes|startsWith|endsWith|match)\s*\()/,
  },
  {
    check: 'message-text-branch',
    severity: 'HIGH',
    pattern: /\bmessage\s*\.\s*(?:includes|startsWith|endsWith|match)\s*\(|\b(?:errorMessage|failureMessage|statusMessage)\b[^\r\n;]{0,120}(?:===\s*(?:['"`]|[A-Z][A-Z0-9_]+)|!==\s*(?:['"`]|[A-Z][A-Z0-9_]+)|includes\s*\(|startsWith\s*\(|endsWith\s*\(|match\s*\()/,
  },
  {
    check: 'normalized-free-form-text-branch',
    severity: 'MEDIUM',
    pattern: /\b(?:content|prompt|text|label|title|name|summary|description)\b[^\r\n;]{0,160}toLowerCase\s*\(\s*\)\s*(?:===|!==|\.\s*(?:includes|startsWith|endsWith|match)\s*\()/,
  },
  {
    check: 'free-form-text-branch',
    severity: 'MEDIUM',
    pattern: /\b(?:content|prompt|text|label|title|name|summary|description)\b[^\r\n;]{0,160}(?:includes\s*\(|startsWith\s*\(|endsWith\s*\(|match\s*\()/,
  },
  {
    check: 'identifier-fragment-branch',
    severity: 'MEDIUM',
    pattern: /\b(?:id|sessionId|runId|schemaId)\b[^\r\n;]{0,120}(?:includes\s*\(|startsWith\s*\(|endsWith\s*\(|match\s*\()/,
  },
];

function isIgnoredFile(relativeFile) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativeFile);
}

export function extractStringBusinessLogicHits(text, relativeFile = '') {
  if (isIgnoredFile(relativeFile)) return [];

  const hits = [];

  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('//')) continue;

    for (const rule of STRING_BUSINESS_LOGIC_RULES) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      const match = pattern.exec(line);
      if (!match) continue;

      hits.push({
        file: relativeFile,
        line: index + 1,
        check: rule.check,
        severity: rule.severity,
        match: match[0].trim().slice(0, 160),
      });
      break;
    }
  }

  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.check.localeCompare(b.check));
}
