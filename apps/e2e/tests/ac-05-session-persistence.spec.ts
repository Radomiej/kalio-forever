import { test } from '@playwright/test';

// AC-05: Session persistence — messages are stored and retrieved across page reloads
test.describe('AC-05: Session persistence', () => {
  test.todo('messages sent in a session are persisted in the database');
  test.todo('reloading the page restores session message history');
  test.todo('multiple sessions are listed in the session panel');
});
