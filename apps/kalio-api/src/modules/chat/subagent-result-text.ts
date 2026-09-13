export function exhaustedLoopResultText(maxIterations: number, lastText: string): string {
  const suffix = lastText.trim().length > 0 ? ` Last assistant text before stopping: ${lastText.trim()}` : '';
  return `Sub-agent stopped after ${maxIterations} tool iteration${maxIterations === 1 ? '' : 's'} without producing a final answer.${suffix}`;
}

export function failedRunResultText(errorMessage: string, lastText: string): string {
  const suffix = lastText.trim().length > 0 ? ` Last assistant text before failure: ${lastText.trim()}` : '';
  return `Sub-agent failed: ${errorMessage}.${suffix}`;
}
