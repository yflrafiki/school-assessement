import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FiX } from 'react-icons/fi';
import { Alert } from './States';
import { errorMessage } from '../lib/forms';

/** Side drawer built on the native <dialog>, so focus trapping and Escape work for free. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-full max-w-xl bg-surface p-0 text-ink shadow-2xl backdrop:bg-nav/40"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label="Close">
              <FiX aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
          )}
        </div>
      )}
    </dialog>
  );
}

/**
 * Confirmation dialog. When `reasonLabel` is set, a reason is required and passed to onConfirm.
 * Shows the server's error and stays open if the action fails.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  reasonLabel,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setReason('');
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const tooShort = !!reasonLabel && reason.trim().length < 3;

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg bg-surface p-0 text-ink shadow-2xl backdrop:bg-nav/40"
    >
      {open && (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tooShort) void confirm();
          }}
          className="space-y-4 p-5"
        >
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {body && <div className="text-sm text-muted">{body}</div>}
          {children}
          {reasonLabel && (
            <div>
              <label htmlFor={reasonId} className="label">
                {reasonLabel}
              </label>
              <textarea
                id={reasonId}
                className="input"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={3}
              />
            </div>
          )}
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button
              type="submit"
              className={danger ? 'btn-danger' : 'btn-primary'}
              disabled={pending || tooShort}
            >
              {pending ? 'Working…' : confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
