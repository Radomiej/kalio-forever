import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_WORKTREE_STATUS_LINES = 40;

export interface CLIAgentAcceptanceHints {
  expectedChangedFiles?: string[];
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

function buildAcceptanceSummary(statusLines: string[], hints: CLIAgentAcceptanceHints | undefined): string | null {
  const normalized = normalizeAcceptanceHints(hints);
  if (!normalized) {
    return null;
  }

  const changedPaths = statusLines.map(parseGitStatusPath);
  const lines = ['Acceptance hints:'];
  if (normalized.expectedChangedFiles && normalized.expectedChangedFiles.length > 0) {
    const matched = normalized.expectedChangedFiles.filter((expected) =>
      changedPaths.some((changed) => changed === expected || changed.endsWith(`/${expected}`)),
    );
    const missing = normalized.expectedChangedFiles.filter((expected) => !matched.includes(expected));
    lines.push(`- expected changed files present in worktree: ${matched.length}/${normalized.expectedChangedFiles.length}`);
    if (missing.length > 0) {
      lines.push(`- missing expected changed files: ${missing.join(', ')}`);
    }
  }
  if (normalized.verificationCommands && normalized.verificationCommands.length > 0) {
    lines.push(`- verification commands requested: ${normalized.verificationCommands.join(' && ')}`);
  }
  return lines.join('\n');
}

export async function getWorktreeStatusSummary(
  workdir: string,
  hints?: CLIAgentAcceptanceHints,
): Promise<string | null> {
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

    const acceptanceSummary = buildAcceptanceSummary(lines, hints);
    if (lines.length === 0) {
      return ['Worktree status after CLI agent: clean.', acceptanceSummary].filter(Boolean).join('\n\n');
    }

    const visibleLines = lines.slice(0, MAX_WORKTREE_STATUS_LINES);
    const suffix = lines.length > visibleLines.length
      ? `\n... ${lines.length - visibleLines.length} more changed paths omitted.`
      : '';
    return [
      `Worktree status after CLI agent:\n${visibleLines.map((line) => `- ${line}`).join('\n')}${suffix}`,
      acceptanceSummary,
    ].filter(Boolean).join('\n\n');
  } catch {
    return null;
  }
}

export function appendWorktreeStatus(output: string, statusSummary: string | null): string {
  if (!statusSummary) {
    return output;
  }
  const trimmedOutput = output.trimEnd();
  return `${trimmedOutput.length > 0 ? `${trimmedOutput}\n\n` : ''}${statusSummary}`;
}

export function hasMissingAcceptanceEvidence(statusSummary: string | null): boolean {
  return statusSummary?.includes('- missing expected changed files:') ?? false;
}
