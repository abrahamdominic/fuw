import React from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import { AnimatedModal } from './animations/AnimatedModal';

export interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onConfirm: () => void | Promise<void>;
}

interface ConfirmDialogProps extends ConfirmDialogState {
  onClose: () => void;
  /** Optional icon override for the header bubble (defaults to AlertTriangle). */
  icon?: React.ComponentType<{ size?: number | string }>;
  /** Optional icon rendered inside the confirmation button. */
  confirmIcon?: React.ComponentType<{ size?: number | string }>;
}

/**
 * Reusable confirmation modal for destructive actions (delete, reject, demote…).
 * Usage: keep a `confirm` state object and render <ConfirmDialog {...state}
 * onClose={() => setConfirm({ ...state, open: false })} />.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onClose,
  icon: HeaderIcon,
  confirmIcon: ConfirmIcon
}: ConfirmDialogProps) {
  const BubbleIcon = HeaderIcon || AlertTriangle;

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      dialogClassName="confirm-dialog"
      labelledBy="confirm-dialog-title"
    >
      <div className={`confirm-dialog-icon ${tone === 'danger' ? 'is-danger' : ''}`}>
        <BubbleIcon size={26} />
      </div>
      <h3 id="confirm-dialog-title">{title}</h3>
      <p className="confirm-dialog-message">{message}</p>
      <div className="confirm-dialog-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
          onClick={handleConfirm}
        >
          {ConfirmIcon && <ConfirmIcon size={16} />}
          {confirmLabel}
        </button>
      </div>
    </AnimatedModal>
  );
}

interface PromptDialogState {
  open: boolean;
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
}

interface PromptDialogProps extends PromptDialogState {
  onClose: () => void;
}

/**
 * Modal replacement for window.prompt() — used for rejection reasons etc.
 */
export function PromptDialog({
  open,
  title,
  message,
  placeholder = '',
  defaultValue = '',
  confirmLabel = 'Submit',
  onSubmit,
  onClose
}: PromptDialogProps) {
  const [value, setValue] = React.useState(defaultValue);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = async () => {
    setBusy(true);
    await onSubmit(value.trim());
    setBusy(false);
    onClose();
  };

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      dialogClassName="confirm-dialog"
      labelledBy="prompt-dialog-title"
    >
      <div className="confirm-dialog-icon is-danger">
        <XCircle size={26} />
      </div>
      <h3 id="prompt-dialog-title">{title}</h3>
      <p className="confirm-dialog-message">{message}</p>
      <textarea
        className="confirm-dialog-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        rows={3}
        autoFocus
        disabled={busy}
      />
      <div className="confirm-dialog-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-danger" onClick={handleSubmit} disabled={busy}>
          {busy ? 'Submitting…' : confirmLabel}
        </button>
      </div>
    </AnimatedModal>
  );
}
