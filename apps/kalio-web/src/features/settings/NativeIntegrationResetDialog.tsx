import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function NativeIntegrationResetDialog({ name, onCancel, onConfirm }: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const parentDialog = previous?.closest('[role="dialog"]');
    const previouslyInert = parentDialog instanceof HTMLElement ? parentDialog.inert : false;
    if (parentDialog instanceof HTMLElement) parentDialog.inert = true;
    cancelRef.current?.focus();
    return () => {
      if (parentDialog instanceof HTMLElement) parentDialog.inert = previouslyInert;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="native-reset-title" aria-describedby="native-reset-description"
        className="w-full max-w-md rounded-xl border border-base-300 bg-base-100 p-5 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); onCancel(); }
          if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            (document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus();
          }
        }}>
        <h4 id="native-reset-title" className="font-semibold">Reset {name} server</h4>
        <p id="native-reset-description" className="mt-3 text-sm">Open native sessions will be disconnected. Saved settings and credentials will not be deleted.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="button" className="btn btn-warning btn-sm" onClick={onConfirm}>Reset server</button>
        </div>
      </div>
    </div>, document.body,
  );
}
