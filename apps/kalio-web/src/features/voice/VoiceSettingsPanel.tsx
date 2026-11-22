import { useEffect, useState } from 'react';
import { Mic } from 'lucide-react';
import { isLocalSpeechPage, speechApi, type SpeechStatus } from './voiceApi';
import { voiceDraftStore } from './voiceDraftStore';
import { VoiceInputControl } from './VoiceInputControl';

function LaunchRecordingRecovery({ draftId }: { draftId: string }) {
  const [text, setText] = useState('');
  return <div className="rounded-xl border border-base-300 p-3">
    <VoiceInputControl scope={{ draftId }} draft={text} onDraft={setText} recoveryOnly />
    <label className="mt-2 block text-sm">Recovered transcript
      <textarea className="textarea textarea-bordered mt-1 w-full" value={text} onChange={(event) => setText(event.target.value)} />
    </label>
    <p className="text-xs">Copy or edit this text. Nothing is sent automatically.</p>
  </div>;
}

export function VoiceSettingsPanel() {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'install' | 'cancel' | null>(null);
  const [launchScopes, setLaunchScopes] = useState<string[]>([]);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const local = isLocalSpeechPage();
  useEffect(() => {
    let active = true;
    void voiceDraftStore.listLaunch().then((drafts) => {
      if (active) setLaunchScopes([...new Set(drafts.map((recording) => recording.draftId).filter((id): id is string => Boolean(id)))]);
    }).catch(() => { if (active) setRecoveryError('Local recordings could not be loaded. Nothing was deleted.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!local) return;
    const controller = new AbortController();
    const refresh = () => {
      void speechApi.status(controller.signal).then((value) => {
        if (!controller.signal.aborted) { setStatus(value); setError(null); setChecking(false); }
      }).catch(() => {
        if (!controller.signal.aborted) {
          setStatus(null); setChecking(false);
          setError('Voice input is unavailable. Check that Kalio is running on this computer.');
        }
      });
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [local]);
  const act = async (cancel: boolean) => {
    setBusy(cancel ? 'cancel' : 'install'); setError(null);
    try { setStatus(await (cancel ? speechApi.cancelInstall() : speechApi.install())); }
    catch {
      setError(cancel
        ? 'Could not confirm cancellation. Check the installation status before trying again.'
        : 'Installation could not start. Try again.');
    }
    finally { setBusy(null); }
  };
  const installing = status?.status === 'installing' || status?.status === 'verifying';
  const ready = status?.status === 'ready' && status.installed;
  const hasSize = status !== null && status.totalBytes > 0;
  const availability = !local ? 'Unavailable here'
    : !status ? checking ? 'Checking availability…' : 'Unavailable'
    : ready ? 'Ready to dictate'
    : status.status === 'installing' ? 'Downloading'
    : status.status === 'verifying' ? 'Verifying'
    : status.status === 'error' ? 'Needs attention' : 'Not installed';
  const mb = (bytes: number) => (bytes / 1000000).toFixed(1);
  const percent = status && hasSize ? Math.min(100, Math.round(status.downloadedBytes / status.totalBytes * 100)) : 0;
  return <section className="space-y-5" aria-label="Voice input settings">
    <div>
      <h2 className="text-lg font-semibold">Voice input</h2>
      <p className="mt-1 text-sm text-base-content/70">Dictate locally, then edit and send when you’re ready.</p>
    </div>
    <div className="rounded-xl border border-base-300 bg-base-200/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0 rounded-lg bg-primary/10 p-2.5 text-primary" aria-hidden="true"><Mic size={20} /></div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Parakeet TDT v3</h3>
            <p className="mt-0.5 text-xs text-base-content/70">On-device dictation · CPU</p>
          </div>
        </div>
        <span role="status" className={`rounded-full px-2.5 py-1 text-xs font-medium ${ready ? 'bg-success/10 text-success' : 'bg-base-300 text-base-content'}`}>{availability}</span>
      </div>
      {!local ? <p className="mt-4 text-sm text-base-content/70">Open Kalio on this computer at localhost to use voice input.</p> : <>
        {!ready && <div className="mt-4 text-sm">
          <p className="font-medium">{hasSize && status ? `${mb(status.totalBytes)} MB download` : 'Download size unavailable'}</p>
          <p className="mt-1 text-xs text-base-content/70">Includes the model and required software.</p>
        </div>}
        {installing && status && <div className="mt-4 space-y-2">
          {status.status === 'installing' ? <>
            <progress className="progress progress-primary block w-full" aria-label="Voice input download" value={hasSize ? status.downloadedBytes : undefined} max={hasSize ? status.totalBytes : undefined} />
            <p className="text-xs tabular-nums text-base-content/70">{hasSize
              ? `${mb(status.downloadedBytes)} / ${mb(status.totalBytes)} MB · ${percent}%` : 'Downloading files…'}</p>
          </> : <p className="text-sm text-base-content/70">Checking downloaded files…</p>}
        </div>}
        {ready && <p className="mt-4 text-sm text-base-content/70">Use the microphone in any chat or new prompt. Up to 60 seconds per recording.</p>}
        {error && <p role="alert" className="mt-4 text-sm text-error">{error}</p>}
        {!error && status?.status === 'error' && <p role="alert" className="mt-4 text-sm text-error">Installation could not finish. Try installing again.</p>}
        {!ready && <div className="mt-4">
          {installing
            ? <button type="button" className="btn btn-sm min-h-10 w-full sm:w-auto" disabled={busy !== null} onClick={() => void act(true)}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel installation'}</button>
            : <button type="button" className="btn btn-primary btn-sm min-h-10 w-full sm:w-auto" disabled={busy !== null || !status || !hasSize} onClick={() => void act(false)}>{busy === 'install' ? 'Starting…' : 'Install'}</button>}
        </div>}
      </>}
    </div>
    {recoveryError && <p role="alert" className="text-sm text-error">{recoveryError}</p>}
    {launchScopes.length > 0 && <div className="space-y-3">
      <h3 className="text-sm font-medium">Unfinished recordings</h3>
      {launchScopes.map((draftId) => <LaunchRecordingRecovery key={draftId} draftId={draftId} />)}
    </div>}
    <details className="text-xs text-base-content/70">
      <summary className="w-fit cursor-pointer rounded py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Model &amp; licenses</summary>
      <p className="mt-1">NVIDIA Parakeet · CC BY 4.0. INT8 ONNX export by csukuangfj. Runtime: sherpa-onnx · Apache-2.0.</p>
      <p className="mt-2">Audio is transcribed locally. Sending your text uses the conversation’s selected provider.</p>
    </details>
  </section>;
}
