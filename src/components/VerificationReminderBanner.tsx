// VerificationReminderBanner — nags an unverified student toward verification.
//
// Like ProfileSetupBanner this is session-scoped: the reminder returns on the
// next sign-in rather than being dismissed forever.
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Clock3, ShieldAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { dismissReminder, reminderDismissed } from '../lib/reminders';

export function VerificationReminderBanner() {
  const navigate = useNavigate();
  const { profile, isProfileComplete, user } = useAuth();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(reminderDismissed('verification', user?.id));
  }, [user?.id]);

  const status = profile?.verificationStatus ?? 'unsubmitted';
  if (hidden || !profile || profile.role !== 'student' || !isProfileComplete) return null;
  if (status === 'verified') return null;

  const dismiss = () => {
    setHidden(true);
    dismissReminder('verification', user?.id);
  };

  // A pending/processing request is doing its job — no nagging while it runs.
  if (status === 'pending' || status === 'processing') return null;

  const needsReplacement = status === 'rejected' || status === 'action_required';
  const retryLater = status === 'verification_unavailable';

  return (
    <div
      className={`profile-setup-banner is-${status}`}
      role="status"
    >
      <div className="profile-setup-banner-icon">
        {needsReplacement ? <ShieldAlert size={19} /> : <BadgeCheck size={19} />}
      </div>
      <div className="profile-setup-banner-body">
        <b>
          {status === 'rejected'
            ? 'Your verification was not approved'
            : status === 'action_required'
              ? 'A clearer document is needed'
              : retryLater
                ? 'Verification could not be completed yet'
                : 'Verify your student identity'}
        </b>
        <span>
          {needsReplacement
            ? profile.verificationReason ||
              'Review the reason and submit again to unlock premium materials.'
            : retryLater
              ? 'Automated verification was unavailable. Retry in a moment to finish verifying.'
              : 'Submit your student ID card or admission letter. Downloads stay locked until verification passes.'}
        </span>
      </div>
      <button
        type="button"
        className="primary profile-setup-banner-cta"
        onClick={() => navigate('/student/verification')}
      >
        {needsReplacement ? 'Submit again' : retryLater ? 'Retry' : 'Verify now'}
        <ArrowRight size={15} />
      </button>
      <button
        type="button"
        className="profile-setup-banner-close"
        aria-label="Dismiss verification notice for this session"
        onClick={dismiss}
      >
        <X size={16} />
      </button>
    </div>
  );
}

export default VerificationReminderBanner;