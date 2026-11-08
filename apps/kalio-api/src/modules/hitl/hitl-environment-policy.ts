/** Host identity is separate from the environment targeted by an operation. */
export function hostApprovalEnvironment(): 'prod' | 'dev' | 'qa' | 'unknown' {
  const profile = process.env['KALIO_INSTALL_PROFILE'];
  return profile === 'prod' || profile === 'dev' || profile === 'qa' ? profile : 'unknown';
}

export function approvalThreshold(configured: number, productionMinimum = 0.95): number {
  const profile = hostApprovalEnvironment();
  return profile === 'prod' || profile === 'unknown' ? Math.max(configured, productionMinimum) : configured;
}

/** Untrusted hints can only RAISE scrutiny, never grant permission or downgrade production. */
export function hasProductionTarget(inputs: readonly { text: string }[], args: Record<string, unknown>): boolean {
  const host = hostApprovalEnvironment();
  if (host === 'prod' || host === 'unknown') return true;
  const production = /\b(?:prod(?:uction)?|produkcj\p{L}*|produkcyjn\p{L}*)/iu;
  if (production.test(JSON.stringify(args))) return true;
  // Target cues, not every mention of "production code" in an implementation task.
  const target = /\b(?:deploy|publish|release|wdro\p{L}*|wdróż\p{L}*|target|environment|środowisko|to jest|this is|na|on)\b[^\n.!?]{0,80}\b(?:prod(?:uction)?|produkcj\p{L}*|produkcyjn\p{L}*)/iu;
  return inputs.some(input => target.test(input.text));
}
