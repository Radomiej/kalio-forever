import { Play } from 'lucide-react';
import { useState } from 'react';
import type { ArchitectSchema } from '../../architect/architect.types';
import type { Persona } from '@kalio/types';

const WELCOME_PROMPTS = [
  'What can you do?',
  'Build a calculator app',
  'Create a todo list',
  'Generate an image of a fox',
];

export interface ConversationLaunchScreenProps {
  activePersonaId: string;
  architectures: ArchitectSchema[];
  heading: string;
  error?: string | null;
  isBusy: boolean;
  onArchitectureChange: (schemaId: string) => void;
  onDraftChange: (content: string) => void;
  onPersonaChange: (personaId: string) => void;
  onProjectPathChange: (projectPath: string) => void;
  onRunPrompt: (content: string) => void;
  personas: Persona[];
  projectPath: string;
  selectedArchitectureId: string;
  testIdPrefix: string;
  subtitle: string;
}

export function ConversationLaunchScreen({
  activePersonaId,
  architectures,
  heading,
  error,
  isBusy,
  onArchitectureChange,
  onDraftChange,
  onPersonaChange,
  onProjectPathChange,
  onRunPrompt,
  personas,
  projectPath,
  selectedArchitectureId,
  testIdPrefix,
  subtitle,
}: ConversationLaunchScreenProps) {
  const [prompt, setPrompt] = useState('');
  const activeArchitecture = selectedArchitectureId === 'single-chat'
    ? null
    : architectures.find((schema) => schema.id === selectedArchitectureId) ?? null;
  const personaDisabled = isBusy || activeArchitecture !== null;

  const submitPrompt = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isBusy) {
      return;
    }
    onRunPrompt(trimmed);
    setPrompt('');
    onDraftChange('');
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-4 py-6" data-testid={`${testIdPrefix}-screen`}>
      <div className="w-full max-w-2xl">
        <p className="text-[10px] uppercase tracking-[0.24em] text-base-content/45">{heading}</p>
        <div className="mt-6 flex flex-col items-center gap-2 text-center select-none">
          <div className="text-primary font-black text-4xl drop-shadow-[0_0_12px_oklch(0.60_0.176_232.6/0.6)]">K</div>
          <h2 className="text-base font-semibold text-base-content/80">KALIO</h2>
          <p className="text-xs leading-relaxed text-base-content/65">{subtitle}</p>
        </div>

        <div className="mt-6 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${testIdPrefix}-persona-select`} className="mb-1 block pl-1 text-[10px] uppercase tracking-wider text-base-content/65">
                Persona
              </label>
              <select
                id={`${testIdPrefix}-persona-select`}
                aria-label="Persona"
                className="select select-bordered select-sm w-full text-sm"
                value={activePersonaId}
                onChange={(event) => onPersonaChange(event.target.value)}
                disabled={personaDisabled}
                data-testid={`${testIdPrefix}-persona-select`}
              >
                {personas.length > 0
                  ? personas.map((persona) => (
                      <option key={persona.id} value={persona.id}>{persona.name}</option>
                    ))
                  : <option value="default">Default</option>}
              </select>
            </div>
            <div>
              <label htmlFor={`${testIdPrefix}-architecture-select`} className="mb-1 block pl-1 text-[10px] uppercase tracking-wider text-base-content/65">
                Workflow
              </label>
              <select
                id={`${testIdPrefix}-architecture-select`}
                aria-label="Workflow"
                className="select select-bordered select-sm w-full text-sm"
                value={selectedArchitectureId}
                onChange={(event) => onArchitectureChange(event.target.value)}
                disabled={isBusy}
                data-testid={`${testIdPrefix}-architecture-select`}
              >
                <option value="single-chat">Single Chat</option>
                {architectures.map((schema) => (
                  <option key={schema.id} value={schema.id}>{schema.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor={`${testIdPrefix}-project-path-input`} className="mb-1 block pl-1 text-[10px] uppercase tracking-wider text-base-content/65">
              Project path
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
          </div>

          <div className="rounded-lg border border-base-300 bg-base-100/80 p-2">
            <textarea
              className="textarea textarea-ghost min-h-24 w-full resize-none text-sm leading-6 focus:outline-none"
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
              placeholder={activeArchitecture ? `Run prompt through ${activeArchitecture.name}` : 'Ask Kalio...'}
              disabled={isBusy}
              data-testid={`${testIdPrefix}-prompt-input`}
            />
            <div className="flex items-center justify-between gap-3 border-t border-base-300/70 px-1 pt-2">
              <span className="truncate text-[11px] text-base-content/65" data-testid={`${testIdPrefix}-routing-summary`}>
                {activeArchitecture ? `Graph runtime: ${activeArchitecture.name}` : 'Direct chat runtime'}
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
        </div>

        <div className="mt-3 flex flex-wrap justify-center gap-2">
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
    </div>
  );
}
