import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Settings, X } from 'lucide-react';

export function HomeExecutionSettings({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const triggerElement = trigger.current;
    element?.showModal();
    closeButton.current?.focus();
    return () => {
      element?.close();
      if (triggerElement?.isConnected) triggerElement.focus();
    };
  }, [open]);

  return (
    <>
      <button ref={trigger} type="button" className="btn btn-ghost btn-square h-11 min-h-11 w-11 shrink-0"
        aria-label="Home app settings" title="Home app settings" aria-haspopup="dialog"
        aria-expanded={open} aria-controls={open ? dialogId : undefined} onClick={() => setOpen(true)}>
        <Settings size={18} aria-hidden="true" />
      </button>
      {open && (
        <dialog ref={dialog} id={dialogId} aria-labelledby={titleId} className="modal"
          onCancel={(event) => { event.preventDefault(); setOpen(false); }}>
          <div className="modal-box w-full max-w-md">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id={titleId} className="text-lg font-semibold">Home app settings</h2>
              <button ref={closeButton} type="button" className="btn btn-ghost btn-square h-11 min-h-11 w-11 shrink-0"
                aria-label="Close Home app settings" onClick={() => setOpen(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {children}
          </div>
        </dialog>
      )}
    </>
  );
}
