import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ExecutionProfile } from '@kalio/types';
import { getDevinCliStatus, resolveDevinCliExecutionProfile } from '../../../services/apiClient';
import { resolveCodexExecutionProfile } from '../../../services/codexModelClient';
import { useCodexModelChoices } from './useCodexModelChoices';

interface Props {
  profiles: ExecutionProfile[];
  value: string;
  onChange: (profileId: string) => void;
  disabled?: boolean;
  testId?: string;
}

export function ExecutionProfileCombobox({ profiles, value, onChange, disabled = false, testId }: Props) {
  const inputId = useId();
  const listId = `${inputId}-options`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [resolvedProfiles, setResolvedProfiles] = useState<ExecutionProfile[]>([]);
  const [resolvingModel, setResolvingModel] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const catalogReady = useRef(false);
  const availableProfiles = useMemo(() => [...profiles, ...resolvedProfiles.filter(
    (resolved) => !profiles.some((profile) => profile.id === resolved.id),
  )], [profiles, resolvedProfiles]);
  const selected = availableProfiles.find((profile) => profile.id === value);
  const codex = useCodexModelChoices(availableProfiles);
  const loadDevinModels = useCallback(async () => {
    const status = await getDevinCliStatus();
    if (status.modelCatalogStatus === 'ready' && !status.modelCatalogStale) {
      catalogReady.current = true;
      setDiscoveredModels(status.models);
      setModelError(null);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void loadDevinModels().catch((error: unknown) => {
      console.error('[ExecutionProfileCombobox] Devin model discovery failed', error);
      if (!cancelled) setModelError('Devin models could not be loaded. Existing profiles remain selectable.');
    });
    return () => { cancelled = true; };
  }, [loadDevinModels]);
  const options = useMemo(() => {
    const search = query.trim().toLowerCase();
    const savedModels = new Set(availableProfiles.filter((profile) => profile.kind === 'devin-cli-acp').map((profile) => profile.model));
    const profileOptions = availableProfiles.filter(profile => profile.kind !== 'codex-app-server'
      || codex.catalogs[profile.authProfileId || profile.id]?.includes(profile.model)).map((profile) => ({
      profile,
      model: profile.model,
      label: executionProfileLabel(profile),
      authProfileId: undefined as string | undefined,
    }));
    const discoveredOptions = discoveredModels
      .filter((model) => !savedModels.has(model))
      .map((model) => ({ profile: null, model, label: `Devin CLI · ${model}`, authProfileId: undefined as string | undefined }));
    const codexOptions = Object.entries(codex.catalogs).flatMap(([authProfileId, models]) => (models ?? [])
      .filter(model => !profileOptions.some(option => option.profile.kind === 'codex-app-server'
        && (option.profile.authProfileId || option.profile.id) === authProfileId && option.model === model))
      .map(model => ({ profile: null, model, label: `Codex · ${model}`, authProfileId })));
    const searchRank = (option: (typeof profileOptions)[number] | (typeof discoveredOptions)[number]) => {
      if (!search) return 0;
      const model = option.model.toLowerCase();
      const label = option.label.toLowerCase();
      if (model === search || label === search) return 0;
      if (model.startsWith(search) || label.startsWith(search)) return 1;
      return 2;
    };
    return [...profileOptions, ...discoveredOptions, ...codexOptions].filter(({ label }) => label.toLowerCase().includes(search))
    .sort((left, right) => searchRank(left) - searchRank(right)
      || profilePriority(left.profile) - profilePriority(right.profile)
      || left.label.localeCompare(right.label));
  }, [availableProfiles, discoveredModels, query, codex.catalogs]);

  const selectOption = async (option: (typeof options)[number]) => {
    setModelError(null);
    if (option.profile) {
      onChange(option.profile.id);
      setOpen(false);
      return;
    }
    setResolvingModel(true);
    try {
      const profile = option.authProfileId
        ? await resolveCodexExecutionProfile(option.authProfileId, option.model)
        : await resolveDevinCliExecutionProfile(option.model);
      setResolvedProfiles((current) => current.some((item) => item.id === profile.id) ? current : [...current, profile]);
      onChange(profile.id);
      setOpen(false);
    } catch (error) {
      console.error('[ExecutionProfileCombobox] Devin profile resolution failed', error);
      setModelError('Could not select this model. Check the CLI connection and retry.');
    } finally {
      setResolvingModel(false);
    }
  };

  return (
    <div className="relative" data-testid={testId}>
      <label className="sr-only" htmlFor={inputId}>Search providers and models</label>
      <input
        id={inputId}
        role="combobox"
        aria-label="Provider and model"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        className="input input-bordered input-sm w-full"
        value={open ? query : selected ? executionProfileLabel(selected) : ''}
        placeholder="Search provider or model…"
        disabled={disabled}
        onFocus={() => {
          setQuery('');
          setOpen(true);
          if (!catalogReady.current) {
            void loadDevinModels().catch((error: unknown) => {
              console.error('[ExecutionProfileCombobox] Devin model refresh failed', error);
              setModelError('Devin models could not be loaded. Existing profiles remain selectable.');
            });
          }
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter' && options[0]) {
            event.preventDefault();
            void selectOption(options[0]);
          }
        }}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Available provider and model choices"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-base-300 bg-base-100 p-1 shadow-xl"
        >
          {options.length > 0 ? options.map((option) => (
            <button
              key={option.profile?.id ?? `${option.authProfileId ?? 'devin'}:${option.model}`}
              type="button"
              role="option"
              aria-selected={option.profile?.id === value}
              disabled={resolvingModel}
              className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-base-200"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void selectOption(option)}
            >
              <span className="min-w-0">
                <span className="block font-medium">{option.label}</span>
                <span className="mt-0.5 block truncate text-xs text-base-content/50">{option.profile?.name ?? (option.authProfileId ? `Codex account: ${option.authProfileId}` : 'Discovered from the connected Devin CLI')}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {!option.authProfileId && isDevinSwe2(option.model) && isSwe2FreePromotionActive()
                  && <span className="badge badge-sm badge-success">Free · Pro+ · Oct 16</span>}
                {option.profile?.id === value && <span className="badge badge-sm badge-primary">Selected</span>}
              </span>
            </button>
          )) : (
            <div className="px-3 py-3 text-sm text-base-content/55" role="status">
              {profiles.length === 0 ? 'No connected providers or agent runtimes are available.' : 'No provider or model matches this search.'}
            </div>
          )}
        </div>
      )}
      {codex.hasAccounts && <button type="button" className="btn btn-xs btn-outline mt-2" disabled={disabled || codex.checking || resolvingModel}
        onClick={() => void codex.refresh()}>{codex.checking ? 'Checking Codex models…' : 'Recheck Codex models'}</button>}
      {codex.error && <p role="alert" className="mt-1 text-xs text-error">{codex.error}</p>}
      {resolvingModel && <p role="status" className="mt-1 text-xs text-base-content/55">Selecting model…</p>}
      {modelError && <p role="alert" className="mt-1 text-xs text-error">{modelError}</p>}
      {selected?.kind === 'devin-cli-acp' && (
        <p className="mt-1 text-xs text-base-content/55" data-testid="selected-model-cost-note">
          {isDevinSwe2(selected.model) && isSwe2FreePromotionActive()
            ? 'SWE-2 is free in Devin Desktop and CLI on Pro or higher through October 16, 2026.'
            : isDevinFreeModel(selected.model)
              ? 'Devin lists SWE-1.7 as unlimited on its Free plan.'
              : 'Devin does not identify this model as free; usage may be billed under your Devin plan.'}
          {' '}<a className="link link-hover" href="https://devin.ai/pricing" target="_blank" rel="noreferrer">Devin pricing</a>
        </p>
      )}
    </div>
  );
}

function profilePriority(profile: ExecutionProfile | null): number {
  if (!profile) return 0;
  if (profile.kind === 'devin-cli-acp' || profile.kind === 'devin-api') return 0;
  if (profile.kind === 'codex-app-server') return 1;
  return 2;
}

function isDevinFreeModel(model: string): boolean {
  return /^swe-1\.7(?:$|[-_.])/i.test(model.trim());
}

function isDevinSwe2(model: string): boolean {
  return /^swe-2(?:$|-)/i.test(model.trim());
}

function isSwe2FreePromotionActive(): boolean {
  return Date.now() < Date.UTC(2026, 9, 17);
}

export function executionProfileLabel(profile: ExecutionProfile): string {
  const runtime = profile.kind === 'devin-cli-acp'
    ? 'Devin CLI'
    : profile.kind === 'devin-api'
      ? 'Devin Cloud'
      : profile.kind === 'codex-app-server'
        ? 'Codex'
        : profile.kind === 'claude-agent-sdk'
          ? 'Claude Code'
          : profile.provider ?? 'Direct LLM';
  return `${runtime} · ${profile.model}`;
}
