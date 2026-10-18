import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export function createWorkflowGateDataRoot() {
  return resolve(tmpdir(), `kalio-workflow-gate-${process.pid}-${Date.now()}`, 'playwright-stack');
}
