import { test } from '@playwright/test';

// AC-08: ChatGateway disconnects gracefully and emits error event
test.describe('AC-08: WebSocket error handling', () => {
  test.todo('error event from server displays error message in chat UI');
  test.todo('streaming indicator disappears on error');
  test.todo('user can send another message after an error');
});
