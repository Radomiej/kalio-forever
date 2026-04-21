import { test } from '@playwright/test';

// AC-01: When user sends a message, assistant response streams token-by-token
test.describe('AC-01: LLM streaming', () => {
  test.todo('sends a message and verifies streaming chunks appear before full response');
  test.todo('streaming indicator is visible while response is in-flight');
  test.todo('message bubble switches from streaming to final state after completion');
});
