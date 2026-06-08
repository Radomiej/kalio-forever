import { CheckCircle2, Loader2, Server, XCircle } from 'lucide-react';
import type { ProviderTestState } from './llm-panel.types';

export function LLMProviderHealthCard({
  activeProviderLabel,
  activeProviderModel,
  activeProviderSource,
  testState,
  testError,
  showWindowsLocalHint,
}: {
  activeProviderLabel: string;
  activeProviderModel: string;
  activeProviderSource: string;
  testState: ProviderTestState;
  testError: string | null;
  showWindowsLocalHint: boolean;
}) {
  const testStateLabel = testState === 'testing'
    ? 'Testing'
    : testState === 'ok'
      ? 'Verified'
      : testState === 'error'
        ? 'Failed'
        : 'Not tested';
  const TestStateIcon = testState === 'testing'
    ? Loader2
    : testState === 'ok'
      ? CheckCircle2
      : testState === 'error'
        ? XCircle
        : Server;

  return (
    <section className="border border-base-300 rounded-xl p-4 bg-base-200/10" data-testid="provider-health-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold mb-1">Provider Health</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
            <span className="badge badge-sm badge-outline font-mono">{activeProviderLabel}</span>
            <span className="font-mono truncate max-w-full">{activeProviderModel}</span>
            <span className="badge badge-xs badge-neutral">{activeProviderSource}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <TestStateIcon
            size={14}
            className={testState === 'testing' ? 'animate-spin text-info' : testState === 'ok' ? 'text-success' : testState === 'error' ? 'text-error' : 'text-base-content/50'}
          />
          <span className={testState === 'ok' ? 'text-success' : testState === 'error' ? 'text-error' : 'text-base-content/60'}>
            {testStateLabel}
          </span>
        </div>
      </div>
      {testState === 'error' && testError ? <p className="mt-3 text-xs text-error" data-testid="provider-health-last-failure">Last test failure: {testError}</p> : null}
      {showWindowsLocalHint ? <p className="mt-3 text-xs text-base-content/50" data-testid="provider-health-local-hint">Windows local provider hint: keep the local server running and use the Windows-reachable localhost URL.</p> : null}
    </section>
  );
}
