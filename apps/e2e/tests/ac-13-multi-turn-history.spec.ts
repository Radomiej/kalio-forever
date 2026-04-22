import { test } from '@playwright/test';

// AC-13: Multi-turn conversation maintains history in LLM context
test.describe('AC-13: Multi-turn conversation history', () => {
  test.skip('second message includes previous user+assistant messages in context', () => {});
  test.skip('session history is capped at configured context window', () => {});
});
