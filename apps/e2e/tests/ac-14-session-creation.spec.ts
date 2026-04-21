import { test } from '@playwright/test';

// AC-14: New session can be created and becomes the active session
test.describe('AC-14: Session creation', () => {
  test.todo('clicking new session creates a session and selects it');
  test.todo('chat input is enabled after session is created');
  test.todo('new session is listed in the session panel');
});
