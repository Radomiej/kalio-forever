import { test } from '@playwright/test';

// AC-08: ChatGateway disconnects gracefully and emits error event
test.describe('AC-08: WebSocket error handling', () => {
  test.skip('error event from server displays error message in chat UI', () => {});
  test.skip('streaming indicator disappears on error', () => {});
  test.skip('user can send another message after an error', () => {});
});
