#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const stackStatePath = resolve(repoRoot, '.kalio-stack/qa-stack-state.json');

export async function collectPaidReadinessChecks(options = {}) {
  const cliApiBase = resolveApiBaseFromArgv(options.argv, options.stderr ?? console.error);
  const apiBase = (options.apiBase ?? (cliApiBase === null ? undefined : cliApiBase) ?? process.env.KALIO_API_BASE_URL ?? resolveManagedApiBase()).replace(/\/$/, '');
  const maxRunningAgeMs = Number(options.maxRunningAgeMs ?? process.env.AGENTFLOW_MAX_RUNNING_AGE_MS ?? 15 * 60 * 1000);
  const maxRecentProviderFailureMs = Number(
    options.maxRecentProviderFailureMs ?? process.env.AGENTFLOW_RECENT_PROVIDER_FAILURE_AGE_MS ?? 60 * 60 * 1000,
  );
  const requiredHighLevelModel = options.requiredHighLevelModel ?? process.env.AGENTFLOW_REQUIRED_HIGH_LEVEL_MODEL;
  const fetchJson = options.fetchJson ?? fetch;
  const now = options.now ?? Date.now();
  const checks = [];

  const llmConfig = await checkJson(fetchJson, checks, `${apiBase}/llm/config`, 'LLM config endpoint is reachable');
  const credentials = await checkJson(fetchJson, checks, `${apiBase}/credentials`, 'Credentials endpoint is reachable');
  const active = await checkJson(fetchJson, checks, `${apiBase}/credentials/active`, 'Active credential endpoint is reachable');
  const runs = await checkJson(fetchJson, checks, `${apiBase}/agent-flows/runs`, 'AgentFlow runs endpoint is reachable');
  const sessions = await checkJson(fetchJson, checks, `${apiBase}/sessions`, 'Sessions endpoint is reachable');
  const codexConfig = await checkJson(fetchJson, checks, `${apiBase}/cli-agents/codex/config`, 'Codex CLI config endpoint is reachable');
  const searchConfig = await checkJson(fetchJson, checks, `${apiBase}/search/config`, 'Web Search config endpoint is reachable');
  const searchTest = await checkJson(
    fetchJson,
    checks,
    `${apiBase}/search/test`,
    'Web Search smoke endpoint is reachable',
    { method: 'POST' },
  );

  if (llmConfig) {
    passOrFail(
      checks,
      llmConfig.provider !== 'mock',
      `LLM provider is live (${llmConfig.provider ?? 'unknown'})`,
      'LLM provider is mock; configure a real provider before paid/live AgentFlow runs.',
    );
    passOrFail(
      checks,
      llmConfig.source === 'db',
      `LLM config source is db`,
      `LLM config source is ${llmConfig.source ?? 'unknown'}; activate a saved credential before paid/live runs.`,
    );
    passOrFail(
      checks,
      typeof llmConfig.model === 'string' && llmConfig.model.trim().length > 0,
      `LLM model is set (${llmConfig.model})`,
      'LLM model is empty.',
    );
  }

  if (Array.isArray(credentials)) {
    passOrFail(
      checks,
      credentials.length > 0,
      `Saved credentials exist (${credentials.length})`,
      'No saved live credentials exist in Kalio.',
    );
  }

  if (active) {
    passOrFail(
      checks,
      typeof active.credentialId === 'string' && active.credentialId.trim().length > 0,
      `Active credential is set (${active.credentialId})`,
      'Active credential is not set.',
    );
    if (typeof active.credentialId === 'string' && active.credentialId.trim().length > 0) {
      const credentialCheck = await checkJson(
        fetchJson,
        checks,
        `${apiBase}/credentials/${active.credentialId}/test`,
        'Active credential provider test endpoint is reachable',
        { method: 'POST' },
      );
      if (credentialCheck) {
        passOrFail(
          checks,
          credentialCheck.ok === true,
          `Active credential provider test passed (${credentialCheck.modelCount ?? 0} model(s))`,
          `Active credential provider test failed: ${credentialCheck.error ?? 'unknown error'}`,
        );
      }
      const completionCheck = await checkJson(
        fetchJson,
        checks,
        `${apiBase}/credentials/${active.credentialId}/test-completion`,
        'Active credential completion smoke endpoint is reachable',
        { method: 'POST' },
      );
      if (completionCheck) {
        passOrFail(
          checks,
          completionCheck.ok === true,
          `Active credential completion smoke passed (` +
            `${completionCheck.provider ?? 'unknown'} / ${completionCheck.model ?? 'unknown'} / ${completionCheck.source ?? 'unknown'})`,
          `Active credential completion smoke failed: ${completionCheck.error ?? 'unknown error'}`,
        );
        if (completionCheck.ok === true && llmConfig) {
          passOrFail(
            checks,
            completionCheck.provider === llmConfig.provider,
            `Active completion smoke used effective provider (${completionCheck.provider ?? 'unknown'})`,
            `Active completion smoke used ${completionCheck.provider ?? 'unknown'} but effective provider is ${llmConfig.provider ?? 'unknown'}`,
          );
          passOrFail(
            checks,
            completionCheck.model === llmConfig.model,
            `Active completion smoke model matches effective model (${completionCheck.model ?? 'unknown'})`,
            `Active completion smoke model ${completionCheck.model ?? 'unknown'} does not match effective model ${llmConfig.model ?? 'unknown'}`,
          );
          passOrFail(
            checks,
            completionCheck.source === llmConfig.source,
            `Active completion smoke source matches effective source (${completionCheck.source ?? 'unknown'})`,
            `Active completion smoke source ${completionCheck.source ?? 'unknown'} does not match effective source ${llmConfig.source ?? 'unknown'}`,
          );
        }
      }
      if (typeof requiredHighLevelModel === 'string' && requiredHighLevelModel.trim().length > 0) {
        const model = requiredHighLevelModel.trim();
        const highLevelCompletionCheck = await checkJson(
          fetchJson,
          checks,
          `${apiBase}/credentials/${active.credentialId}/test-completion`,
          `Required high-level model completion smoke endpoint is reachable (${model})`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model }),
          },
        );
        if (highLevelCompletionCheck) {
          passOrFail(
            checks,
            highLevelCompletionCheck.ok === true,
            `Required high-level model completion smoke passed (` +
              `${highLevelCompletionCheck.provider ?? 'unknown'} / ${highLevelCompletionCheck.model ?? 'unknown'})`,
            `Required high-level model completion smoke failed for ${model}: ${highLevelCompletionCheck.error ?? 'unknown error'}`,
          );
          if (highLevelCompletionCheck.ok === true) {
            passOrFail(
              checks,
              highLevelCompletionCheck.model === model,
              `Required high-level model smoke used ${model}`,
              `Required high-level model smoke used ${highLevelCompletionCheck.model ?? 'unknown'} instead of ${model}`,
            );
          }
        }
      }
    }
  }

  if (Array.isArray(runs)) {
    const staleRunning = runs
      .map((snapshot) => snapshot?.run)
      .filter((run) => run?.status === 'running' && isStale(run.updatedAt, now, maxRunningAgeMs));
    passOrFail(
      checks,
      staleRunning.length === 0,
      'No stale running AgentFlow runs found',
      `Found stale running AgentFlow runs: ${staleRunning.map((run) => run.id).join(', ')}`,
    );
    const recentAgentFlowProviderFailures = findRecentAgentFlowProviderFailures(runs, now, maxRecentProviderFailureMs);
    passOrFail(
      checks,
      recentAgentFlowProviderFailures.length === 0,
      'No recent AgentFlow provider failures found',
      `Recent AgentFlow provider failures found: ${recentAgentFlowProviderFailures.join(', ')}`,
    );
  }

  if (Array.isArray(sessions)) {
    const recentProviderFailures = await findRecentProviderFailures(fetchJson, apiBase, sessions, now, maxRecentProviderFailureMs);
    passOrFail(
      checks,
      recentProviderFailures.length === 0,
      'No recent provider-failed Architecture conversation projections found',
      `Recent Architecture provider failures found: ${recentProviderFailures.join(', ')}`,
    );
  }

  if (codexConfig) {
    passOrFail(
      checks,
      codexConfig.enabled === true,
      'Codex CLI agent is enabled',
      'Codex CLI agent is disabled.',
    );
    passOrFail(
      checks,
      codexConfig.model === 'gpt-5.4-mini',
      'Codex CLI default model is gpt-5.4-mini',
      `Codex CLI default model is ${codexConfig.model ?? '(empty)'}, expected gpt-5.4-mini.`,
    );
  }

  if (searchConfig) {
    passOrFail(
      checks,
      searchConfig.configured === true,
      `Web Search is configured (${searchConfig.provider ?? 'unknown'})`,
      `Web Search is not configured (${searchConfig.provider ?? 'unknown'}); configure it before paid research/persistence runs.`,
    );
  }

  if (searchTest) {
    passOrFail(
      checks,
      searchTest.ok === true,
      'Web Search smoke passed',
      `Web Search smoke failed: ${searchTest.error ?? 'unknown error'}`,
    );
  }

  return checks;
}

export async function runPaidReadinessCheck(options = {}) {
  const stderr = options.stderr ?? console.error;
  const apiBaseFromArgv = resolveApiBaseFromArgv(options.argv, stderr);
  if (apiBaseFromArgv === null) {
    return 1;
  }
  const checks = await collectPaidReadinessChecks(options);
  const stdout = options.stdout ?? console.log;

  for (const check of checks) {
    stdout(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    stderr(`\nAgentFlow paid-run readiness failed: ${failed.length} blocker(s).`);
    return 1;
  }

  stdout('\nAgentFlow paid-run readiness passed.');
  return 0;
}

function resolveApiBaseFromArgv(argv, stderr = console.error) {
  if (!Array.isArray(argv)) return undefined;
  const apiIndex = argv.indexOf('--api');
  if (apiIndex === -1) return undefined;
  const value = argv[apiIndex + 1];
  if (typeof value !== 'string' || value.trim().length === 0 || value.startsWith('--')) {
    stderr('Missing value for --api.');
    return null;
  }
  return value.trim();
}

async function checkJson(fetchJson, checks, url, successMessage, init) {
  try {
    const response = await fetchJson(url, init);
    if (!response.ok) {
      checks.push({ ok: false, message: `${successMessage}: HTTP ${response.status}` });
      return null;
    }
    checks.push({ ok: true, message: successMessage });
    try {
      return await response.json();
    } catch (error) {
      checks.push({ ok: false, message: `${successMessage}: invalid JSON (${error instanceof Error ? error.message : String(error)})` });
      return null;
    }
  } catch (error) {
    checks.push({ ok: false, message: `${successMessage}: ${error instanceof Error ? error.message : String(error)}` });
    return null;
  }
}

function passOrFail(checks, condition, passMessage, failMessage) {
  checks.push({ ok: Boolean(condition), message: condition ? passMessage : failMessage });
}

function isStale(updatedAt, now, maxRunningAgeMs) {
  if (typeof updatedAt !== 'number') return true;
  return now - updatedAt > maxRunningAgeMs;
}

function findRecentAgentFlowProviderFailures(snapshots, now, maxAgeMs) {
  return snapshots
    .filter((snapshot) => {
      const updatedAt = snapshot?.run?.updatedAt;
      return typeof snapshot?.run?.id === 'string'
        && typeof updatedAt === 'number'
        && now - updatedAt <= maxAgeMs;
    })
    .flatMap((snapshot) => {
      const runId = snapshot.run.id;
      const events = Array.isArray(snapshot.events) ? snapshot.events : [];
      return events
        .filter((event) => containsProviderFailureText(event?.message))
        .map((event) => `${runId}:${event.id ?? 'event'}`);
    });
}

async function findRecentProviderFailures(fetchJson, apiBase, sessions, now, maxAgeMs) {
  const recentSessions = sessions
    .filter((session) => typeof session?.id === 'string' && typeof session?.updatedAt === 'number')
    .filter((session) => now - session.updatedAt <= maxAgeMs)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 20);
  const failures = [];

  for (const session of recentSessions) {
    try {
      const response = await fetchJson(`${apiBase}/sessions/${session.id}/messages`);
      if (!response.ok) continue;
      const messages = await response.json();
      if (!Array.isArray(messages)) continue;
      const providerFailure = messages.find((message) => {
        const content = typeof message?.content === 'string' ? message.content : '';
        return content.includes('Architecture run failed') && containsProviderFailureText(content);
      });
      if (providerFailure) {
        failures.push(`${session.id}:${providerFailure.id ?? 'message'}`);
      }
    } catch {
      // Missing message history should not hide the explicit endpoint checks above.
    }
  }

  return failures;
}

function containsProviderFailureText(value) {
  return typeof value === 'string'
    && (value.includes('451 Unavailable For Legal Reasons') || value.includes('cross-border isolation policy'));
}

function resolveManagedApiBase() {
  if (existsSync(stackStatePath)) {
    try {
      const state = JSON.parse(readFileSync(stackStatePath, 'utf8'));
      if (Number.isInteger(state?.backendPort) && state.backendPort > 0) {
        return `http://127.0.0.1:${state.backendPort}/api`;
      }
    } catch {
      // Fall through to the manual development default below.
    }
  }

  return 'http://127.0.0.1:3016/api';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const exitCode = await runPaidReadinessCheck({ argv: process.argv.slice(2) });
  process.exit(exitCode);
}
