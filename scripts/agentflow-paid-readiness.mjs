#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const stackStatePath = resolve(repoRoot, '.kalio-stack/qa-stack-state.json');

export async function collectPaidReadinessChecks(options = {}) {
  const apiBase = (options.apiBase ?? process.env.KALIO_API_BASE_URL ?? resolveManagedApiBase()).replace(/\/$/, '');
  const maxRunningAgeMs = Number(options.maxRunningAgeMs ?? process.env.AGENTFLOW_MAX_RUNNING_AGE_MS ?? 15 * 60 * 1000);
  const fetchJson = options.fetchJson ?? fetch;
  const now = options.now ?? Date.now();
  const checks = [];

  const llmConfig = await checkJson(fetchJson, checks, `${apiBase}/llm/config`, 'LLM config endpoint is reachable');
  const credentials = await checkJson(fetchJson, checks, `${apiBase}/credentials`, 'Credentials endpoint is reachable');
  const active = await checkJson(fetchJson, checks, `${apiBase}/credentials/active`, 'Active credential endpoint is reachable');
  const runs = await checkJson(fetchJson, checks, `${apiBase}/agent-flows/runs`, 'AgentFlow runs endpoint is reachable');
  const codexConfig = await checkJson(fetchJson, checks, `${apiBase}/cli-agents/codex/config`, 'Codex CLI config endpoint is reachable');

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

  return checks;
}

export async function runPaidReadinessCheck(options = {}) {
  const checks = await collectPaidReadinessChecks(options);
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;

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
  const exitCode = await runPaidReadinessCheck();
  process.exit(exitCode);
}
