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
  const [providerFilter, setProviderFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [resolvedProfiles, setResolvedProfiles] = useState<ExecutionProfile[]>([]);
  const [resolvingModel, setResolvingModel] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const catalogReady = useRef(false);
  const availableProfiles = useMemo(() => [...profiles, ...resolvedProfiles.filter(
    (resolved) => !profiles.some((profile) => profile.id === resolved.id),
  )], [profiles, resolvedProfiles]);
  const selected = availableProfiles.find((profile) => profile.id === value);
  const providers = [...new Set(availableProfiles.map(profile => executionProfileLabel(profile).split(' · ')[0]))].sort();
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
    const profileOptions = availableProfiles.map((profile) => ({
      profile,
      model: profile.model,
      label: executionProfileLabel(profile),
      unavailable: !profile.enabled ? 'Profile disabled' : profile.kind === 'codex-app-server'
        && !codex.catalogs[profile.authProfileId || profile.id]?.includes(profile.model) ? 'Model unavailable. Check the provider connection.' : '',
      authProfileId: undefined as string | undefined,
    }));
    const discoveredOptions = discoveredModels
      .filter((model) => !savedModels.has(model))
      .map((model) => ({ profile: null, model, label: `Devin CLI · ${model}`, unavailable: '', authProfileId: undefined as string | undefined }));
    const codexOptions = Object.entries(codex.catalogs).flatMap(([authProfileId, models]) => (models ?? [])
      .filter(model => !profileOptions.some(option => option.profile.kind === 'codex-app-server'
        && (option.profile.authProfileId || option.profile.id) === authProfileId && option.model === model))
      .map(model => ({ profile: null, model, label: `Codex · ${model}`, unavailable: '', authProfileId })));
    const searchRank = (option: (typeof profileOptions)[number] | (typeof discoveredOptions)[number]) => {
      if (!search) return 0;
      const model = option.model.toLowerCase();
      const label = option.label.toLowerCase();
      if (model === search || label === search) return 0;
      if (model.startsWith(search) || label.startsWith(search)) return 1;
      return 2;
    };
    return [...profileOptions, ...discoveredOptions, ...codexOptions].filter(({ label }) => label.toLowerCase().includes(search)
      && (!providerFilter || label.startsWith(`${providerFilter} · `)))
    .sort((left, right) => searchRank(left) - searchRank(right)
      || profilePriority(left.profile) - profilePriority(right.profile)
      || left.label.localeCompare(right.label));
  }, [availableProfiles, discoveredModels, query, providerFilter, codex.catalogs]);

  const selectOption = async (option: (typeof options)[number]) => {
    if (disabled || resolvingModel || option.unavailable) return;
    setModelError(null);
    if (option.profile) {
      onChange(option.profile.id);
      inputRef.current?.focus();
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
      inputRef.current?.focus();
      setOpen(false);
    } catch (error) {
      console.error('[ExecutionProfileCombobox] Devin profile resolution failed', error);
      setModelError('Could not select this model. Check the CLI connection and retry.');
    } finally {
      setResolvingModel(false);
    }
  };

  return (
    <div className="relative min-w-0" data-testid={testId}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          inputRef.current?.focus();
          setOpen(false);
        }
      }}>
      <label className="sr-only" htmlFor={inputId}>Search providers and models</label>
      <input
        id={inputId}
        ref={inputRef}
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
          if (open || disabled) return;
          setQuery('');
          setOpen(true);
          if (codex.hasAccounts) void codex.refresh();
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
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            document.getElementById(listId)?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
          }
          if (event.key === 'Enter' && open && options[0]) {
            event.preventDefault();
            void selectOption(options[0]);
          }
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-base-300 bg-base-100 p-1 shadow-xl">
          {providers.length > 1 && <select aria-label="Filter by provider" className="select select-bordered select-sm mb-1 w-full"
            value={providerFilter} onChange={event => setProviderFilter(event.target.value)}>
            <option value="">All providers</option>
            {providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}
          </select>}
        <div
          id={listId}
          role="listbox"
          aria-label="Available provider and model choices"
        >
          {options.length > 0 ? options.map((option) => (
            <button
              key={option.profile?.id ?? `${option.authProfileId ?? 'devin'}:${option.model}`}
              type="button"
              role="option"
              aria-selected={option.profile?.id === value}
              disabled={disabled || resolvingModel || Boolean(option.unavailable)}
              className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-base-200"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void selectOption(option)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                event.preventDefault();
                const rows = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
                const index = rows.indexOf(event.currentTarget);
                rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
              }}
            >
              <span className="min-w-0">
                <span className="block break-words font-medium [overflow-wrap:anywhere]">{option.label}</span>
                {option.unavailable && <span className="mt-0.5 block text-xs text-base-content/60">{option.unavailable}</span>}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {option.profile?.id === value && <span className="badge badge-sm badge-primary">Selected</span>}
              </span>
            </button>
          )) : (
            <div className="px-3 py-3 text-sm text-base-content/55" role="status">
              {profiles.length === 0 ? 'No connected providers or agent runtimes are available.' : 'No provider or model matches this search.'}
            </div>
          )}
        </div>
        </div>
      )}
      {codex.error && <p role="alert" className="mt-1 text-xs text-error">{codex.error}</p>}
      {resolvingModel && <p role="status" className="mt-1 text-xs text-base-content/55">Selecting model…</p>}
      {modelError && <p role="alert" className="mt-1 text-xs text-error">{modelError}</p>}
    </div>
  );
}

function profilePriority(profile: ExecutionProfile | null): number {
  if (!profile) return 0;
  if (profile.kind === 'devin-cli-acp' || profile.kind === 'devin-api') return 0;
  if (profile.kind === 'codex-app-server') return 1;
  return 2;
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
