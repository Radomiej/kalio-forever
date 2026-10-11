import { useEffect, useId, useRef, useState } from 'react';
import type { ExecutionProfile } from '@kalio/types';

interface AppModelSettingsModalProps {
  appName: string;
  profiles: ExecutionProfile[];
  executionProfileIds: string[];
  loading?: boolean;
  error?: string | null;
  onSave: (ids: string[]) => Promise<void>;
  onClose: () => void;
}

export function AppModelSettingsModal({ appName, profiles, executionProfileIds, loading = false,
  error, onSave, onClose }: AppModelSettingsModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [ids, setIds] = useState(executionProfileIds);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      await onSave(ids.filter(Boolean));
      onClose();
    } catch (reason: unknown) {
      setSaveError(`Could not save model settings: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  };
  const move = (index: number, direction: number) => {
    const next = [...ids];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    setIds(next);
  };
  return (
    <dialog ref={dialog} aria-labelledby={titleId} className="modal"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="modal-box w-full max-w-md">
        <h2 id={titleId} className="text-lg font-semibold">Models for {appName}</h2>
        <p className="mt-2 text-sm">First choice, then fallbacks in order. An empty list uses the saved default.</p>
        {loading && <p role="status">Loading execution profiles…</p>}
        {(error || saveError) && <p role="alert" className="mt-2 text-error">{saveError ?? error}</p>}
        <fieldset disabled={busy || loading} className="mt-3 space-y-3">
          {ids.map((id, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <label className="min-w-0 flex-1">
                <span className="text-xs">{index === 0 ? 'Preferred model' : `Fallback ${index}`}</span>
                <select aria-label={index === 0 ? 'Preferred model' : `Fallback ${index}`}
                  className="select select-bordered w-full" value={id}
                  onChange={(event) => setIds(ids.map((value, at) => at === index ? event.target.value : value))}>
                  <option value="">Choose a profile</option>
                  {id && !profiles.some((profile) => profile.id === id && profile.enabled)
                    && <option value={id} disabled>Unavailable profile · {id}</option>}
                  {profiles.filter((profile) => profile.enabled).map((profile) => (
                    <option key={profile.id} value={profile.id} disabled={ids.includes(profile.id) && profile.id !== id}>
                      {profile.name} · {profile.model}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-sm" aria-label={`Move model ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" className="btn btn-sm" aria-label={`Move model ${index + 1} down`} disabled={index === ids.length - 1} onClick={() => move(index, 1)}>↓</button>
              <button type="button" className="btn btn-sm" aria-label={`Remove model ${index + 1}`} onClick={() => setIds(ids.filter((_, at) => at !== index))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" disabled={ids.includes('') || !profiles.some((profile) => profile.enabled && !ids.includes(profile.id))}
            onClick={() => setIds([...ids, ''])}>Add model</button>
        </fieldset>
        <div className="modal-action">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || loading || !!error || ids.includes('')}
            onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </dialog>
  );
}
