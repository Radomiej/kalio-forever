import { Check, Mic, X } from 'lucide-react';
import { useSettingsStore } from '../settings/settingsStore';
import { useVoiceInput } from './useVoiceInput';
import type { SpeechScope } from './voiceApi';
import type { VoiceDraft } from './voiceDraftStore';

interface Props {
  scope: SpeechScope | null;
  draft: string;
  onDraft: (text: string) => void;
  disabled?: boolean;
  recoveryOnly?: boolean;
}

export function VoiceInputControl({ scope, draft, onDraft, disabled = false, recoveryOnly = false }: Props) {
  const voice = useVoiceInput(scope, draft, onDraft);
  const openSettings = useSettingsStore((state) => state.requestSettingsTab);
  const busy = voice.phase !== 'idle';
  const recording = voice.phase === 'recording';
  const wasInserted = (item: VoiceDraft) => item.cleanupOnly
    && (item.deliveryState === 'inserted' || item.expectedComposer === draft);
  const recoverable = voice.savedDrafts.filter((item) => !wasInserted(item) || Boolean(voice.error) || recoveryOnly);
  return <div className="relative min-w-0 max-w-full text-xs" data-testid="voice-input-control">
    {!recoveryOnly && <div className={`inline-flex max-w-full items-center gap-1 rounded-full bg-[#2d2046] text-[#f4efff] shadow-sm ${busy ? 'border border-[#9e83d0]/40 p-1' : 'p-0 ring-1 ring-inset ring-[#9e83d0]/40'}`}>
      {busy ? <>
        <button type="button" aria-label="Discard recording" title="Discard recording" onClick={voice.cancel}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"><X size={16} /></button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1 px-0.5">
          {recording ? <>
            <span className="sr-only" role="status">Recording. Confirm to transcribe.</span>
            <span className="tabular-nums" aria-label="Recording duration">{voice.seconds}s</span>
            <div aria-hidden="true" className="flex h-9 items-center gap-0.5 motion-reduce:hidden">
              {voice.level.bars.map((amplitude, index) => (
                <span key={index} data-audio-bar className={`w-1 rounded-full ${amplitude >= 0.05 ? 'bg-emerald-300' : 'bg-white/20'}`}
                  style={{ height: `${Math.max(3, amplitude * 34)}px` }} />
              ))}
            </div>
            <meter className="hidden w-16 shrink-0 motion-reduce:block" aria-label="Microphone level" min={0} max={1} value={Math.min(1, voice.level.rms * 5)} />
          </> : <span role="status" className="min-w-0 max-w-24 break-words leading-tight">
            {voice.phase === 'starting' ? 'Allow microphone...' : 'Transcribing...'}
          </span>}
        </div>
        <button type="button" aria-label="Stop recording" title="Confirm and transcribe" disabled={!recording}
          onClick={() => void voice.stop()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#99e8ad] text-[#14291c] hover:bg-[#b8f3c7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-200 disabled:opacity-30"><Check size={18} /></button>
      </> : voice.ready ? <button type="button" aria-label="Record voice input" title="Record" disabled={disabled}
        onClick={() => void voice.start()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-violet-300"><Mic size={16} className="text-violet-200" /></button>
        : <button type="button" disabled={disabled || !scope} onClick={() => openSettings('voice')}
          aria-label={voice.status?.status === 'installing' || voice.status?.status === 'verifying' ? 'Preparing microphone' : 'Set up microphone'}
          title={voice.status?.status === 'installing' || voice.status?.status === 'verifying' ? 'Preparing microphone' : 'Set up microphone'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-violet-300"><Mic size={16} /></button>}
    </div>}
    {(voice.error || voice.saveState === 'error' || (voice.phase === 'transcribing' && voice.saveState === 'saving') || voice.transcript !== null || recoverable.length > 0 || voice.unsavedIds.length > 0) && <div
      data-testid="voice-feedback"
      className={recoveryOnly ? 'min-w-0 max-w-full break-words' : 'absolute bottom-full right-0 z-20 mb-2 w-60 max-w-[calc(100vw-6rem)] max-h-[60vh] overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-2 break-words shadow-lg'}>
      {voice.error && <p role="alert" className="mt-1 max-w-xl text-xs text-error">{voice.error}</p>}
      {voice.saveState === 'error' && <div className="mt-1 flex items-center gap-2 text-warning" role="status">
        <span>Not saved. Keep this window open.</span><button type="button" disabled={busy} onClick={() => void voice.retrySave()} className="underline">Retry save</button>
    </div>}
    {voice.phase === 'transcribing' && voice.saveState === 'saving' && <span className="ml-2 text-base-content/50">Saving...</span>}
    {!busy && (recoverable.length > 0 || voice.unsavedIds.length > 0) && <details className="mt-1 max-w-xl" open={Boolean(voice.error)}>
      <summary className="w-fit cursor-pointer text-base-content/60">Saved recordings ({recoverable.length + voice.unsavedIds.filter((id) => !recoverable.some((item) => item.id === id)).length})</summary>
      <div className="mt-1 space-y-1 rounded-lg bg-base-200 p-2">
        {recoverable.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3">
          <span>{(item.sampleCount / item.sampleRate).toFixed(1)} s{item.cleanupOnly ? wasInserted(item) ? ' - text inserted' : ' - text not inserted' : ''}</span>
          {!item.cleanupOnly && <button type="button" disabled={busy || !voice.ready} onClick={() => void voice.retry(item)} className="text-violet-400 underline">Retry</button>}
          {item.cleanupOnly && !wasInserted(item) && item.deliveryText && <button type="button" disabled={busy} onClick={() => voice.recover(item)} className="text-violet-400 underline">Recover text</button>}
          <button type="button" disabled={busy} onClick={() => void voice.remove(item.id)} className="text-base-content/70 underline">Delete</button>
          {item.cleanupOnly && item.deliveryText && <details className="w-full"><summary className="cursor-pointer text-base-content/50">Saved text</summary><p className="whitespace-pre-wrap break-words">{item.deliveryText}</p></details>}
        </div>)}
        {voice.unsavedIds.filter((id) => !recoverable.some((item) => item.id === id)).map((id) => <button key={id} type="button" disabled={busy} onClick={() => void voice.remove(id)} className="underline">Delete unsaved</button>)}
      </div>
    </details>}
    {voice.transcript !== null && <div className="mt-1 max-w-xl rounded-lg bg-violet-500/10 p-2">
      <p className="whitespace-pre-wrap break-words">{voice.transcript}</p>
      <button type="button" onClick={() => void voice.insert()} className="mr-3 text-violet-400 underline">Insert</button>
      <button type="button" onClick={voice.discard} className="text-base-content/60 underline">Dismiss</button>
    </div>}
    </div>}
  </div>;
}
