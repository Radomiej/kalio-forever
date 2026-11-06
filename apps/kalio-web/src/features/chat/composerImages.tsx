import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { ImagePlus, X } from 'lucide-react';
import type { ChatAttachment, ExecutionProfile } from '@kalio/types';
import { apiClient } from '../../services/apiClient';

const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const maxImageBytes = 10 * 1024 * 1024;

export interface ComposerSendOptions {
  interrupt?: boolean;
  images?: File[];
  attachments?: ChatAttachment[];
}

export function imageInputBlockReason(profile: ExecutionProfile | undefined, isChat: boolean): string | undefined {
  if (!isChat) return 'Image attachments are unavailable in this workflow.';
  if (!profile?.enabled) return 'Choose a connected execution profile to send images.';
  if (profile.kind === 'devin-api') {
    return 'Devin API chat in Kalio currently accepts text only.';
  }
  if (profile.kind === 'claude-agent-sdk') return 'Claude chat in Kalio currently accepts text only.';
  if (profile.kind === 'codex-app-server' || profile.kind === 'devin-cli-acp' || profile.kind === 'direct-llm') return;
  return 'Image input is unavailable for this execution profile.';
}

export async function uploadComposerImages(sessionId: string, images: File[]): Promise<ChatAttachment[]> {
  const attachments: ChatAttachment[] = [];
  for (const image of images) {
    const form = new FormData();
    form.append('file', image);
    const response = await apiClient.post<ChatAttachment>(
      '/api/sessions/' + encodeURIComponent(sessionId) + '/vfs/upload', form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    attachments.push(response.data);
  }
  return attachments;
}

export function useComposerImages(blockReason?: string, disabled = false) {
  const input = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<File[]>([]);
  const [error, setError] = useState<string>();
  const add = (files: File[]) => {
    if (!files.length || disabled) return;
    if (blockReason) {
      setError(blockReason);
      return;
    }
    const accepted = files.filter((file) => imageTypes.includes(file.type) && file.size > 0 && file.size < maxImageBytes);
    setError(accepted.length === files.length ? undefined : 'Choose a nonempty PNG, JPEG, WebP or GIF smaller than 10 MiB.');
    setImages((current) => [...current, ...accepted]);
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    if (!event.clipboardData.getData?.('text/plain')) event.preventDefault();
    add(files);
  };
  return {
    images,
    onPaste,
    clear: () => { setImages([]); setError(undefined); },
    picker: (
      <>
        <input ref={input} type="file" hidden multiple accept={imageTypes.join(',')} aria-label="Image files"
          onChange={(event) => {
            add(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = '';
          }} />
        <button type="button" aria-label="Add image" title={blockReason ?? 'Add image'}
          aria-disabled={Boolean(blockReason)} disabled={disabled}
          className="btn btn-ghost h-11 min-h-11 w-11 shrink-0 p-0"
          onClick={() => blockReason ? setError(blockReason) : input.current?.click()}>
          <ImagePlus size={18} aria-hidden="true" />
        </button>
      </>
    ),
    preview: (images.length > 0 || error) && (
      <div className="space-y-1">
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((image, index) => (
              <ImageDraftPreview key={index} image={image} disabled={disabled}
                onRemove={() => setImages((current) => current.filter((_, item) => item !== index))} />
            ))}
          </div>
        )}
        {error && <p className="text-xs text-warning" role="alert">{error}</p>}
        {images.length > 0 && (
          <p className="text-xs text-base-content/70" role="status">
            {blockReason ?? 'Add a text prompt to send your images. Image support depends on the selected runtime and model.'}
          </p>
        )}
      </div>
    ),
  };
}

function ImageDraftPreview({ image, disabled, onRemove }: { image: File; disabled: boolean; onRemove: () => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    const preview = URL.createObjectURL(image);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [image]);
  return (
    <div className="flex max-w-full items-center gap-1 rounded-lg bg-base-200 px-1">
      {url && <img src={url} alt="" className="size-9 shrink-0 rounded object-cover" />}
      <span className="min-w-0 truncate text-xs">{image.name}</span>
      <button type="button" className="btn btn-ghost h-11 min-h-11 w-11 shrink-0 p-0"
        aria-label={'Remove ' + image.name} onClick={onRemove} disabled={disabled}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
