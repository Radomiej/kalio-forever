import { imageInputBlockReason, useComposerImages } from '../composerImages';
import { ChevronDown, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ExecutionProfile, Persona, Project } from '@kalio/types';
import type { ArchitectSchema } from '../../architect/architect.types';
import { PersonaCombobox } from './PersonaCombobox';
import { ProjectPicker } from '../../projects/ProjectPicker';
import { CodeIntelligenceQuickTrust } from './CodeIntelligenceQuickTrust';
import { ExecutionProfileCombobox } from './ExecutionProfileCombobox';
import { VoiceInputControl } from '../../voice/VoiceInputControl';
import { getLaunchSpeechScope } from '../../voice/voiceApi';

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
  onRunImagePrompt?: (content: string, profileId: string, images: File[]) => Promise<boolean>;
  onRunPrompt: (content: string, executionProfileId?: string) => void;
  personas: Persona[];
  executionProfiles?: ExecutionProfile[];
  selectedExecutionProfileId?: string;
  onExecutionProfileChange?: (profileId: string) => void;
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
  executionProfileId?: string;
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
  isBusy: launchBusy,
  onArchitectureChange,
  onDraftChange,
  onPersonaChange,
  onProjectPathChange,
  onProjectChange,
  onRunPrompt,
  onRunImagePrompt,
  personas,
  executionProfiles,
  selectedExecutionProfileId,
  onExecutionProfileChange,
  projectPath,
  projectId = 'system:none',
  selectedPersonaId,
  selectedArchitectureId,
  testIdPrefix,
  subtitle,
}: NewChatScreenProps) {
  const [prompt, setPrompt] = useState('');
  const [voiceScope] = useState(getLaunchSpeechScope);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [launchMode, setLaunchMode] = useState<LaunchMode>('chat');
  const [lastWorkflowId, setLastWorkflowId] = useState(() => (
    selectedArchitectureId === 'single-chat' ? architectures[0]?.id ?? '' : selectedArchitectureId
  ));
  const didInitializeModeRef = useRef(false);
  const personaOptions: LaunchOption[] = personas.length > 0
    ? personas.map((persona) => ({ id: persona.id, label: persona.name, executionProfileId: persona.executionProfileId }))
    : [{ id: 'default', label: 'Default' }];
  const workflowOptions: LaunchOption[] = architectures.map((schema) => ({ id: schema.id, label: schema.name }));
  const activeWorkflowId = resolveWorkflowSelection(selectedArchitectureId, lastWorkflowId, workflowOptions);
  const activeArchitecture = workflowOptions.find((schema) => schema.id === activeWorkflowId) ?? null;
  const activePersona = personaOptions.find((persona) => persona.id === selectedPersonaId) ?? personaOptions[0] ?? null;
  const recommendedProfile = executionProfiles?.find((profile) => profile.id === activePersona?.executionProfileId);
  const [sendingImages, setSendingImages] = useState(false);
  const isBusy = launchBusy || sendingImages;
  const blockReason = onRunImagePrompt
    ? imageInputBlockReason(executionProfiles?.find((profile) => profile.id === selectedExecutionProfileId), launchMode === 'chat')
    : 'Image attachments are unavailable from this launch screen.';
  const imageDraft = useComposerImages(blockReason, isBusy);
  const canRun = executionProfiles === undefined || Boolean(selectedExecutionProfileId);

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
    if (!trimmed || isBusy || !canRun) {
      return;
    }
    if (imageDraft.images.length) {
      if (blockReason || !onRunImagePrompt || !selectedExecutionProfileId) return;
      setSendingImages(true);
      void onRunImagePrompt(trimmed, selectedExecutionProfileId, imageDraft.images)
        .then((sent) => { if (sent) imageDraft.clear(); })
        .finally(() => setSendingImages(false));
      return;
    }
    onRunPrompt(trimmed, selectedExecutionProfileId);
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
    <section className="flex min-h-full w-full items-stretch justify-stretch p-2 lg:p-4" data-testid={`${testIdPrefix}-screen`}>
      <div className="mx-auto flex min-h-full w-full min-w-0 max-w-4xl flex-col rounded-2xl bg-base-100/70 p-3 sm:px-7 lg:px-8 lg:py-5">
        <p className="text-[11px] uppercase tracking-[0.2em] text-base-content/50">{heading}</p>

        <div className="mt-2 flex flex-col items-center gap-1 text-center select-none lg:mt-4 lg:gap-1.5">
          <div className="text-primary font-black text-2xl lg:text-4xl drop-shadow-[0_0_10px_oklch(0.60_0.176_232.6/0.5)]">K</div>
          <h2 className="text-sm font-semibold text-base-content/80 lg:text-base">KALIO</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-base-content/65">{subtitle}</p>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm mt-2 min-h-10 self-start gap-2 lg:hidden"
          aria-controls={`${testIdPrefix}-configuration`}
          aria-expanded={configurationOpen}
          onClick={() => setConfigurationOpen((open) => !open)}
        >
          Conversation settings
          <ChevronDown size={14} aria-hidden="true" className={configurationOpen ? 'rotate-180' : undefined} />
        </button>
        <div id={`${testIdPrefix}-configuration`} className={configurationOpen ? undefined : 'hidden lg:block'}>
        <div className="mt-6">
          <p className="mb-1.5 pl-1 text-[11px] uppercase tracking-wider text-base-content/65">Mode</p>
          <div className="inline-grid w-full max-w-sm grid-cols-2 gap-1 rounded-xl bg-base-200/70 p-1 ring-1 ring-inset ring-base-300/65" data-testid={`${testIdPrefix}-mode-switcher`}>
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

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
              <>
                <ProjectPicker
                  value={projectId}
                  onChange={(project) => {
                    onProjectChange(project);
                    onProjectPathChange(project.path ?? '');
                  }}
                  disabled={isBusy}
                  testId={`${testIdPrefix}-project-picker`}
                />
                {projectId !== 'system:none' && <CodeIntelligenceQuickTrust projectId={projectId} />}
              </>
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

        {executionProfiles !== undefined && onExecutionProfileChange && (
          <div className="mt-4">
            <div className="mb-1.5 block pl-1 text-[11px] uppercase tracking-wider text-base-content/65">
              Provider and model
            </div>
            <ExecutionProfileCombobox
              profiles={executionProfiles}
              value={selectedExecutionProfileId ?? ''}
              onChange={onExecutionProfileChange}
              disabled={isBusy}
              testId={`${testIdPrefix}-execution-profile`}
            />
            <p className="mt-1 pl-1 text-xs text-base-content/50">
              {recommendedProfile
                ? `${recommendedProfile.name} is recommended for this persona. Change it here for this conversation.`
                : 'Choose a connected runtime/provider and model for this conversation.'}
            </p>
          </div>
        )}

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
            onPaste={imageDraft.onPaste}
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
          {imageDraft.preview}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-base-300/70 px-1 pt-2">
            {imageDraft.picker}
            <VoiceInputControl scope={voiceScope} draft={prompt} disabled={isBusy} onDraft={(text) => {
              setPrompt(text); onDraftChange(text);
            }} />
            {!voiceScope && <p role="alert">Local voice draft storage is unavailable.</p>}
            <button
              type="button"
              className="btn btn-primary btn-sm gap-2"
              onClick={() => submitPrompt(prompt)}
              disabled={isBusy || prompt.trim().length === 0 || !canRun || Boolean(blockReason && imageDraft.images.length)}
              data-testid={`${testIdPrefix}-run-prompt`}
            >
              <Play size={14} />
              Run
            </button>
          </div>
        </div>
        {executionProfiles !== undefined && executionProfiles.length === 0 && (
          <p className="mt-3 text-xs text-warning" role="status">
            No execution provider is available. Connect Devin/Codex or add a provider in Settings before starting a chat.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {WELCOME_PROMPTS.map((quickPrompt) => (
            <button
              key={quickPrompt}
              type="button"
              className="btn btn-sm btn-ghost border border-base-300/70 text-xs text-base-content/70 hover:border-primary/40 hover:text-primary"
              onClick={() => submitPrompt(quickPrompt)}
              disabled={isBusy || imageDraft.images.length > 0}
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
