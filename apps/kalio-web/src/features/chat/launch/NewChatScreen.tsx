import { Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Persona, Project } from '@kalio/types';
import type { ArchitectSchema } from '../../architect/architect.types';
import { PersonaCombobox } from './PersonaCombobox';
import { ProjectPicker } from '../../projects/ProjectPicker';

const WELCOME_PROMPTS = [
  'What can you do?',
  'Build a calculator app',
  'Create a todo list',
  'Generate an image of a fox',
];

export interface NewChatScreenProps {
  architectures: ArchitectSchema[];
  heading: string;
  error?: string | null;
  isBusy: boolean;
  onArchitectureChange: (schemaId: string) => void;
  onDraftChange: (content: string) => void;
  onPersonaChange: (personaId: string) => void;
  onProjectPathChange: (projectPath: string) => void;
  onProjectChange?: (project: Project) => void;
  onRunPrompt: (content: string) => void;
  personas: Persona[];
  projectPath: string;
  projectId?: string;
  selectedPersonaId: string;
  selectedArchitectureId: string;
  testIdPrefix: string;
  subtitle: string;
}

type LaunchMode = 'chat' | 'workflow';

type LaunchOption = {
  id: string;
  label: string;
};

function resolveWorkflowSelection(
  preferredWorkflowId: string,
  fallbackWorkflowId: string,
  workflowOptions: LaunchOption[],
): string {
  if (preferredWorkflowId !== 'single-chat' && workflowOptions.some((workflow) => workflow.id === preferredWorkflowId)) {
    return preferredWorkflowId;
  }
  if (fallbackWorkflowId && workflowOptions.some((workflow) => workflow.id === fallbackWorkflowId)) {
    return fallbackWorkflowId;
  }
  return workflowOptions[0]?.id ?? '';
}

export function NewChatScreen({
  architectures,
  heading,
  error,
  isBusy,
  onArchitectureChange,
  onDraftChange,
  onPersonaChange,
  onProjectPathChange,
  onProjectChange,
  onRunPrompt,
  personas,
  projectPath,
  projectId = 'system:none',
  selectedPersonaId,
  selectedArchitectureId,
  testIdPrefix,
  subtitle,
}: NewChatScreenProps) {
  const [prompt, setPrompt] = useState('');
  const [launchMode, setLaunchMode] = useState<LaunchMode>('chat');
  const [lastWorkflowId, setLastWorkflowId] = useState(() => (
    selectedArchitectureId === 'single-chat' ? architectures[0]?.id ?? '' : selectedArchitectureId
  ));
  const didInitializeModeRef = useRef(false);
  const personaOptions: LaunchOption[] = personas.length > 0
    ? personas.map((persona) => ({ id: persona.id, label: persona.name }))
    : [{ id: 'default', label: 'Default' }];
  const workflowOptions: LaunchOption[] = architectures.map((schema) => ({ id: schema.id, label: schema.name }));
  const activeWorkflowId = resolveWorkflowSelection(selectedArchitectureId, lastWorkflowId, workflowOptions);
  const activeArchitecture = workflowOptions.find((schema) => schema.id === activeWorkflowId) ?? null;
  const activePersona = personaOptions.find((persona) => persona.id === selectedPersonaId) ?? personaOptions[0] ?? null;

  useEffect(() => {
    if (selectedArchitectureId !== 'single-chat') {
      setLastWorkflowId(selectedArchitectureId);
    }
  }, [selectedArchitectureId]);

  useEffect(() => {
    if (didInitializeModeRef.current) {
      return;
    }
    didInitializeModeRef.current = true;
    setLaunchMode('chat');
    if (selectedArchitectureId !== 'single-chat') {
      onArchitectureChange('single-chat');
    }
  }, [onArchitectureChange, selectedArchitectureId]);

  useEffect(() => {
    if (launchMode !== 'workflow') {
      return;
    }
    if (activeWorkflowId && selectedArchitectureId !== activeWorkflowId) {
      onArchitectureChange(activeWorkflowId);
    }
  }, [activeWorkflowId, launchMode, onArchitectureChange, selectedArchitectureId]);

  const submitPrompt = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isBusy) {
      return;
    }
    onRunPrompt(trimmed);
    setPrompt('');
    onDraftChange('');
  };

  const handleModeChange = (mode: LaunchMode) => {
    if (mode === launchMode) {
      return;
    }
    setLaunchMode(mode);
    if (mode === 'chat') {
      onArchitectureChange('single-chat');
      return;
    }

    const nextWorkflowId = resolveWorkflowSelection(selectedArchitectureId, lastWorkflowId, workflowOptions);
    if (!nextWorkflowId) {
      return;
    }
    setLastWorkflowId(nextWorkflowId);
    onArchitectureChange(nextWorkflowId);
  };

  const handleArchitectureSelection = (schemaId: string) => {
    setLastWorkflowId(schemaId);
    onArchitectureChange(schemaId);
  };

  return (
    <section className="flex min-h-full w-full items-stretch justify-stretch px-4 py-4" data-testid={`${testIdPrefix}-screen`}>
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col rounded-2xl bg-base-100/70 px-5 py-5 sm:px-7 lg:px-8">
        <p className="text-[11px] uppercase tracking-[0.2em] text-base-content/50">{heading}</p>

        <div className="mt-4 flex flex-col items-center gap-1.5 text-center select-none">
          <div className="text-primary font-black text-4xl drop-shadow-[0_0_10px_oklch(0.60_0.176_232.6/0.5)]">K</div>
          <h2 className="text-base font-semibold text-base-content/80">KALIO</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-base-content/65">{subtitle}</p>
        </div>

        <div className="mt-6">
          <p className="mb-1.5 pl-1 text-[11px] uppercase tracking-wider text-base-content/65">Mode</p>
          <div className="inline-grid min-w-72 grid-cols-2 gap-1 rounded-xl bg-base-200/70 p-1 ring-1 ring-inset ring-base-300/65" data-testid={`${testIdPrefix}-mode-switcher`}>
            {[
              { id: 'chat' as const, label: 'Chat mode', disabled: false },
              { id: 'workflow' as const, label: 'Workflow mode', disabled: workflowOptions.length === 0 },
            ].map((modeOption) => (
              <button
                key={modeOption.id}
                type="button"
                className={`btn btn-sm min-h-0 rounded-xl border ${
                  launchMode === modeOption.id
                    ? 'border-primary/40 bg-primary/12 text-primary'
                    : 'border-transparent bg-transparent text-base-content/65 hover:border-base-300 hover:text-base-content/85'
                }`}
                onClick={() => handleModeChange(modeOption.id)}
                disabled={isBusy || modeOption.disabled}
                data-testid={`${testIdPrefix}-mode-${modeOption.id}`}
              >
                {modeOption.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div>
            {launchMode === 'chat' ? (
              <>
                <label htmlFor={`${testIdPrefix}-persona-select`} className="mb-1.5 block pl-1 text-[11px] uppercase tracking-wider text-base-content/65">
                  Persona
                </label>
                <PersonaCombobox
                  id={`${testIdPrefix}-persona-select`}
                  options={personaOptions}
                  value={selectedPersonaId}
                  onChange={onPersonaChange}
                  disabled={isBusy}
                  testId={`${testIdPrefix}-persona-select`}
                />
              </>
            ) : (
              <>
                <label htmlFor={`${testIdPrefix}-architecture-select`} className="mb-1.5 block pl-1 text-[11px] uppercase tracking-wider text-base-content/65">
                  Workflow
                </label>
                <select
                  id={`${testIdPrefix}-architecture-select`}
                  aria-label="Workflow"
                  className="select select-bordered select-sm w-full text-sm"
                  value={activeArchitecture?.id ?? workflowOptions[0]?.id ?? ''}
                  onChange={(event) => handleArchitectureSelection(event.target.value)}
                  disabled={isBusy || workflowOptions.length === 0}
                  data-testid={`${testIdPrefix}-architecture-select`}
                >
                  {workflowOptions.length === 0 ? (
                    <option value="">No workflows available</option>
                  ) : (
                    workflowOptions.map((schema) => (
                      <option key={schema.id} value={schema.id}>{schema.label}</option>
                    ))
                  )}
                </select>
              </>
            )}
          </div>

          <div>
            {onProjectChange ? (
              <ProjectPicker
                value={projectId}
                onChange={(project) => {
                  onProjectChange(project);
                  onProjectPathChange(project.path ?? '');
                }}
                disabled={isBusy}
                testId={`${testIdPrefix}-project-picker`}
              />
            ) : (
              <>
                <label htmlFor={`${testIdPrefix}-project-path-input`} className="mb-1.5 block pl-1 text-[11px] uppercase tracking-wider text-base-content/65">
                  Project folder
                </label>
                <input
                  id={`${testIdPrefix}-project-path-input`}
                  aria-label="Project path"
                  className="input input-bordered input-sm w-full text-sm"
                  value={projectPath}
                  onChange={(event) => onProjectPathChange(event.target.value)}
                  disabled={isBusy}
                  data-testid={`${testIdPrefix}-project-path-input`}
                />
              </>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-base-300/70 bg-base-200/45 p-2.5">
          <label htmlFor={`${testIdPrefix}-prompt-input`} className="sr-only">
            Prompt
          </label>
          <textarea
            id={`${testIdPrefix}-prompt-input`}
            aria-label="Prompt"
            className="textarea textarea-ghost min-h-28 w-full resize-none text-sm leading-6 focus:outline-none"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              onDraftChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitPrompt(prompt);
              }
            }}
            placeholder={launchMode === 'workflow' && activeArchitecture
              ? `Run prompt through ${activeArchitecture.label}`
              : `Ask ${activePersona?.label ?? 'Kalio'}...`}
            disabled={isBusy}
            data-testid={`${testIdPrefix}-prompt-input`}
          />
          <div className="flex items-center justify-between gap-3 border-t border-base-300/70 px-1 pt-2">
            <span className="truncate text-[11px] text-base-content/65" data-testid={`${testIdPrefix}-routing-summary`}>
              {launchMode === 'workflow' && activeArchitecture
                ? `Workflow runtime: ${activeArchitecture.label}`
                : `Chat runtime: ${activePersona?.label ?? 'Default'}`}
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm gap-2"
              onClick={() => submitPrompt(prompt)}
              disabled={isBusy || prompt.trim().length === 0}
              data-testid={`${testIdPrefix}-run-prompt`}
            >
              <Play size={14} />
              Run
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {WELCOME_PROMPTS.map((quickPrompt) => (
            <button
              key={quickPrompt}
              type="button"
              className="btn btn-sm btn-ghost border border-base-300/70 text-xs text-base-content/70 hover:border-primary/40 hover:text-primary"
              onClick={() => submitPrompt(quickPrompt)}
              disabled={isBusy}
            >
              {quickPrompt}
            </button>
          ))}
        </div>
        {error && (
          <p className="mt-4 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error-content" data-testid={`${testIdPrefix}-send-error`}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
