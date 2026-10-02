// PremiumGateModal — shown when a document is refused for lack of premium access.
//
// It never decides access itself: the message and the destination come from the
// server's `has_premium_access()` answer (see lib/premium.ts), so the UI and the
// storage policies always agree.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Crown, ShieldAlert, X } from 'lucide-react';
import { AnimatedModal } from './animations/AnimatedModal';
import type { BlockReason } from '../lib/premium';

const ICONS: Record<BlockReason, React.ReactNode> = {
  'signed-out': <ShieldAlert size={30} />,
  unsubmitted: <BadgeCheck size={30} />,
  pending: <ShieldAlert size={30} />,
  rejected: <ShieldAlert size={30} />,
  unverified: <BadgeCheck size={30} />,
  'no-plan': <Crown size={30} />
};

const TITLES: Record<BlockReason, string> = {
  'signed-out': 'Sign in to continue',
  unsubmitted: 'Verify your student identity',
  pending: 'Verification in progress',
  rejected: 'Verification not approved',
  unverified: 'Verified students only',
  'no-plan': 'Premium plan required'
};

interface Props {
  open: boolean;
  reason: BlockReason;
  message: string;
  onClose: () => void;
}

export function PremiumGateModal({ open, reason, message, onClose }: Props) {
  const navigate = useNavigate();

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const action = (() => {
    switch (reason) {
      case 'signed-out':
        return { label: 'Sign in', target: '/login' };
      case 'pending':
        return { label: 'View status', target: '/student/verification' };
      case 'no-plan':
        return { label: 'See plans', target: '/student/subscription' };
      case 'unsubmitted':
      case 'unverified':
      case 'rejected':
      default:
        return { label: reason === 'rejected' ? 'Submit again' : 'Start verification', target: '/student/verification' };
    }
  })();

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      overlayClassName="protected-modal-overlay"
      dialogClassName="protected-modal premium-gate-modal"
      overlayStyle={{ zIndex: 420 }}
    >
      <div className="premium-gate-body">
        <span className="premium-gate-icon" aria-hidden="true">
          {ICONS[reason] ?? <Crown size={30} />}
        </span>
        <h3>{TITLES[reason] ?? 'Premium access required'}</h3>
        <p>{message}</p>
        <p className="premium-gate-footnote">
          Browsing the catalogue, previews, study tools and the AI assistant stay free.
        </p>

        <div className="premium-gate-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Not now
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => go(action.target)}
          >
            {action.label} <ArrowRight size={15} />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="premium-gate-close"
        onClick={onClose}
        aria-label="Close"
      >
        <X size={17} />
      </button>
    </AnimatedModal>
  );
}

export default PremiumGateModal;