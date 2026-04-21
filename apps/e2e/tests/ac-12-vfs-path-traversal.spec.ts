import { test } from '@playwright/test';

// AC-12: VFS read is restricted to session-scoped workspace (path traversal guard)
test.describe('AC-12: VFS path traversal guard', () => {
  test.todo('reading ../../../etc/passwd is rejected');
  test.todo('writing outside workspace root is rejected');
  test.todo('valid in-scope paths succeed');
});
