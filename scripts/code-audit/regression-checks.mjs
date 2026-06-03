const REVIEW_LEAD_PATTERNS = [
  { check: 'todo-marker', severity: 'LOW', pattern: /\bTODO\b/g },
  { check: 'hack-marker', severity: 'MEDIUM', pattern: /\bHACK\b/g },
  { check: 'temporary-marker', severity: 'MEDIUM', pattern: /\btemporary\b/gi },
  { check: 'workaround-marker', severity: 'MEDIUM', pattern: /\bworkaround\b/gi },
  { check: 'browser-confirm', severity: 'MEDIUM', pattern: /\bconfirm\s*\(\s*(['"`])[^'"`]*\1/g },
  { check: 'browser-alert', severity: 'HIGH', pattern: /\balert\s*\(\s*(['"`])[^'"`]*\1/g },
  { check: 'literal-placeholder', severity: 'MEDIUM', pattern: /\bplaceholder\s*=\s*(['"`])[^'"`{]*\1/g },
  { check: 'literal-aria-label', severity: 'MEDIUM', pattern: /\baria-label\s*=\s*(['"`])[^'"`{]*\1/g },
  { check: 'literal-title', severity: 'LOW', pattern: /\btitle\s*=\s*(['"`])[^'"`{]*\1/g },
  { check: 'locale-branch', severity: 'MEDIUM', pattern: /\blocale\s*===\s*(['"`])[^'"`]*\1/g },
  { check: 'domain-list-lead', severity: 'MEDIUM', pattern: /\b(category|facet|searchFields|availableFields)\b/g },
  { check: 'search-api-lead', severity: 'MEDIUM', pattern: /\b(searchObjects|smartSearchObjects|buildSearchPath)\b/g },
];

function lineForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

export function extractRegressionReviewLeads(text, relativeFile = '') {
  const hits = [];

  for (const rule of REVIEW_LEAD_PATTERNS) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
      hits.push({
        file: relativeFile,
        line: lineForIndex(text, match.index),
        check: rule.check,
        severity: rule.severity,
        match: match[0].slice(0, 120),
      });
    }
  }

  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.check.localeCompare(b.check));
}
