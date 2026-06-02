const DEFAULT_TRAVERSAL_EXCLUDED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'playwright-report',
  'test-results',
  'output',
]);

export function shouldSkipTraversalDirectory(name: string): boolean {
  return DEFAULT_TRAVERSAL_EXCLUDED_DIRECTORIES.has(name.trim().toLowerCase());
}
