import React from 'react';
import { fx } from '../../lib/motion';

interface AnimatedModalProps {
  open: boolean;
  onClose?: () => void;
  /** Class applied to the inner dialog element (must already be styled in CSS). */
  dialogClassName?: string;
  /** Overlay class — defaults to `.modal-overlay` (`.protected-modal-overlay` for security dialogs). */
  overlayClassName?: string;
  /** Extra overlay styles (e.g. raising z-index above sibling dialogs). */
  overlayStyle?: React.CSSProperties;
  /** Extra dialog styles (e.g. custom width triggers). */
  dialogStyle?: React.CSSProperties;
  labelledBy?: string;
  children: React.ReactNode;
  /** Skip the overlay click-to-close handler (e.g. forms that must not dismiss). */
  dismissable?: boolean;
  id?: string;
}

/**
 * Modal skeleton: overlay + dialog with CSS entrance motion.
 *
 * Wrap an existing modal's body — pass the exact CSS class of the dialog so
 * all existing styling (sizing, scroll, shadow) is preserved. Entrance is a
 * plain CSS keyframe (see `.fx-overlay-in` / `.fx-scale-in`), so nothing
 * depends on a JS animation runtime.
 */
export function AnimatedModal({
  open,
  onClose,
  dialogClassName = 'modal-card',
  overlayClassName = 'modal-overlay',
  overlayStyle,
  dialogStyle,
  labelledBy,
  children,
  dismissable = true,
  id
}: AnimatedModalProps) {
  if (!open) return null;
  return (
    <div
      className={`${overlayClassName} ${fx.overlay}`}
      style={overlayStyle}
      role="presentation"
      onClick={(e) => {
        // Keep overlay clicks from reaching an ancestor (e.g. a wrapping card
        // link) while still letting the dialog's own close handler run.
        e.stopPropagation();
        if (dismissable) onClose?.();
      }}
    >
      <div
        id={id}
        className={`${dialogClassName} ${fx.scaleIn}`}
        style={dialogStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}