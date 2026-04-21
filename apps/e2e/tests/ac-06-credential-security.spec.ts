import { test } from '@playwright/test';

// AC-06: Credentials — API keys stored encrypted, never exposed in API responses
test.describe('AC-06: Credential security', () => {
  test.todo('creating a credential returns record without apiKey field');
  test.todo('listing credentials does not include apiKey values');
  test.todo('credential can be deleted');
});
