import { test } from '@playwright/test';

// AC-02: When a tool with requiresConfirmation=true is called, user sees HITL dialog before execution
test.describe('AC-02: HITL tool confirmation', () => {
  test.todo('tool that requires confirmation shows confirmation dialog');
  test.todo('confirming tool proceeds with execution and shows result');
  test.todo('cancelling tool shows cancellation message and does not execute');
  test.todo('HITL dialog shows tool name and arguments');
});
