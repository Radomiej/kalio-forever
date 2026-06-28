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
    pattern: /\b(?:id|sessionId|runId|schemaId|toolCallId|messageId|taskId|nodeId)\b\s*(?:\?\.)?\.\s*(?:includes|startsWith|endsWith|match)\s*\(/,
  },
  {
    check: 'string-equals-branch',
    severity: 'MEDIUM',
    pattern: /(?:['"`][^'"`]*['"`]|\b(?:message|content|prompt|text|label|title|name|summary|description)\b[^\r\n;]{0,120})\.equals\s*\(/,
  },
];

function isIgnoredFile(relativeFile) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativeFile);
}

function isRuntimeControlPath(relativeFile) {
  return [
    'apps/kalio-api/src/modules/architecture/',
    'apps/kalio-api/src/modules/agent-flow/',
    'apps/kalio-api/src/modules/chat/',
    'apps/kalio-api/src/modules/cli-agent/',
    'apps/kalio-api/src/modules/tool/',
    'apps/kalio-api/src/modules/raapp/',
    'apps/kalio-web/src/features/chat/graph/',
    'apps/kalio-web/src/store/agentRuntime',
    'apps/kalio-web/src/features/sessions/session',
  ].some((prefix) => relativeFile.startsWith(prefix));
}

function severityFor(rule, relativeFile) {
  if (rule.check === 'identifier-fragment-branch' && isRuntimeControlPath(relativeFile)) {
    return 'HIGH';
  }
  return rule.severity;
}

function isTypeGuardLine(rule, line) {
  if (rule.check !== 'message-text-branch') {
    return false;
  }
  return /\btypeof\b[^\r\n;]*(?:errorMessage|failureMessage|statusMessage)[^\r\n;]*===\s*['"`]string['"`]/.test(line)
    || /(?:errorMessage|failureMessage|statusMessage)\s*:\s*typeof\b[^\r\n;]*===\s*['"`]string['"`]/.test(line);
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
      if (isTypeGuardLine(rule, line)) continue;

      hits.push({
        file: relativeFile,
        line: index + 1,
        check: rule.check,
        severity: severityFor(rule, relativeFile),
        match: match[0].trim().slice(0, 160),
      });
      break;
    }
  }

  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.check.localeCompare(b.check));
}
