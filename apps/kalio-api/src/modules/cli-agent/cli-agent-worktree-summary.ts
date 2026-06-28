import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_WORKTREE_STATUS_LINES = 40;

export interface CLIAgentAcceptanceHints {
  expectedChangedFiles?: string[];
  verificationCommands?: string[];
}

export interface CLIAgentWorktreeStatusEvidence {
  summary: string;
  changedPaths: string[];
  expectedChangedFiles?: string[];
  matchedExpectedChangedFiles?: string[];
  missingExpectedChangedFiles?: string[];
  verificationCommands?: string[];
}

function normalizePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/^\.\/+/, '');
}

function uniqueNonEmpty(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  return [...new Set(values.map(normalizePath).filter((value) => value.length > 0))];
}

function parseGitStatusPath(line: string): string {
  const payload = line.length > 3 ? line.slice(3).trim() : line.trim();
  const renameTarget = payload.includes(' -> ') ? payload.split(' -> ').at(-1) ?? payload : payload;
  return normalizePath(renameTarget.replace(/^"|"$/g, ''));
}

export function normalizeAcceptanceHints(hints: CLIAgentAcceptanceHints | undefined): CLIAgentAcceptanceHints | undefined {
  const expectedChangedFiles = uniqueNonEmpty(hints?.expectedChangedFiles);
  const verificationCommands = uniqueNonEmpty(hints?.verificationCommands);
  if (expectedChangedFiles.length === 0 && verificationCommands.length === 0) {
    return undefined;
  }
  return {
    ...(expectedChangedFiles.length > 0 ? { expectedChangedFiles } : {}),
    ...(verificationCommands.length > 0 ? { verificationCommands } : {}),
  };
}

export function appendAcceptanceInstructions(prompt: string, hints: CLIAgentAcceptanceHints | undefined): string {
  const normalized = normalizeAcceptanceHints(hints);
  if (!normalized) {
    return prompt;
  }

  const lines = ['Acceptance tracking for the parent orchestrator:'];
  if (normalized.expectedChangedFiles && normalized.expectedChangedFiles.length > 0) {
    lines.push('Expected changed files:');
    lines.push(...normalized.expectedChangedFiles.map((file) => `- ${file}`));
  }
  if (normalized.verificationCommands && normalized.verificationCommands.length > 0) {
    lines.push('Verification commands to run or explicitly report if skipped:');
    lines.push(...normalized.verificationCommands.map((command) => `- ${command}`));
  }

  return `${prompt.trimEnd()}\n\n${lines.join('\n')}`;
}

function buildAcceptanceEvidence(
  changedPaths: string[],
  hints: CLIAgentAcceptanceHints | undefined,
): Pick<
  CLIAgentWorktreeStatusEvidence,
  'expectedChangedFiles' | 'matchedExpectedChangedFiles' | 'missingExpectedChangedFiles' | 'verificationCommands'
> {
  const normalized = normalizeAcceptanceHints(hints);
  if (!normalized) {
    return {};
  }

  const evidence: Pick<
    CLIAgentWorktreeStatusEvidence,
    'expectedChangedFiles' | 'matchedExpectedChangedFiles' | 'missingExpectedChangedFiles' | 'verificationCommands'
  > = {};
  if (normalized.expectedChangedFiles && normalized.expectedChangedFiles.length > 0) {
    const matched = normalized.expectedChangedFiles.filter((expected) =>
      changedPaths.some((changed) => changed === expected || changed.endsWith(`/${expected}`)),
    );
    const missing = normalized.expectedChangedFiles.filter((expected) => !matched.includes(expected));
    evidence.expectedChangedFiles = normalized.expectedChangedFiles;
    evidence.matchedExpectedChangedFiles = matched;
    evidence.missingExpectedChangedFiles = missing;
  }
  if (normalized.verificationCommands && normalized.verificationCommands.length > 0) {
    evidence.verificationCommands = normalized.verificationCommands;
  }
  return evidence;
}

function buildAcceptanceSummary(
  evidence: Pick<
    CLIAgentWorktreeStatusEvidence,
    'expectedChangedFiles' | 'matchedExpectedChangedFiles' | 'missingExpectedChangedFiles' | 'verificationCommands'
  >,
): string | null {
  const lines = ['Acceptance hints:'];
  if (evidence.expectedChangedFiles && evidence.expectedChangedFiles.length > 0) {
    const matched = evidence.matchedExpectedChangedFiles ?? [];
    const missing = evidence.missingExpectedChangedFiles ?? [];
    lines.push(`- expected changed files present in worktree: ${matched.length}/${evidence.expectedChangedFiles.length}`);
    if (missing.length > 0) {
      lines.push(`- missing expected changed files: ${missing.join(', ')}`);
    }
  }
  if (evidence.verificationCommands && evidence.verificationCommands.length > 0) {
    lines.push(`- verification commands requested: ${evidence.verificationCommands.join(' && ')}`);
  }
  if (lines.length === 1) return null;
  return lines.join('\n');
}

export async function getWorktreeStatusSummary(
  workdir: string,
  hints?: CLIAgentAcceptanceHints,
): Promise<CLIAgentWorktreeStatusEvidence | null> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--short'], {
      cwd: workdir,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 128 * 1024,
    });
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    const changedPaths = lines.map(parseGitStatusPath);
    const acceptanceEvidence = buildAcceptanceEvidence(changedPaths, hints);
    const acceptanceSummary = buildAcceptanceSummary(acceptanceEvidence);
    const statusSummary = lines.length === 0
      ? ['Worktree status after CLI agent: clean.', acceptanceSummary].filter(Boolean).join('\n\n')
      : '';
    if (lines.length === 0) {
      return {
        summary: statusSummary,
        changedPaths,
        ...acceptanceEvidence,
      };
    }

    const visibleLines = lines.slice(0, MAX_WORKTREE_STATUS_LINES);
    const suffix = lines.length > visibleLines.length
      ? `\n... ${lines.length - visibleLines.length} more changed paths omitted.`
      : '';
    return {
      summary: [
        `Worktree status after CLI agent:\n${visibleLines.map((line) => `- ${line}`).join('\n')}${suffix}`,
        acceptanceSummary,
      ].filter(Boolean).join('\n\n'),
      changedPaths,
      ...acceptanceEvidence,
    };
  } catch {
    return null;
  }
}

export function appendWorktreeStatus(output: string, statusEvidence: CLIAgentWorktreeStatusEvidence | null): string {
  if (!statusEvidence) {
    return output;
  }
  const trimmedOutput = output.trimEnd();
  return `${trimmedOutput.length > 0 ? `${trimmedOutput}\n\n` : ''}${statusEvidence.summary}`;
}

export function hasMissingAcceptanceEvidence(statusEvidence: CLIAgentWorktreeStatusEvidence | null): boolean {
  return (statusEvidence?.missingExpectedChangedFiles?.length ?? 0) > 0;
}
