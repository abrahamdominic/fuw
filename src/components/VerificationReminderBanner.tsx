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
  if (hidden || !profile || profile.role !== 'student') return null;
  if (status === 'verified') return null;

  const dismiss = () => {
    setHidden(true);
    dismissReminder('verification', user?.id);
  };

  // A pending request is doing its job — no nagging while it is being reviewed.
  if (status === 'pending') return null;

  const needsProfile = !isProfileComplete;

  return (
    <div
      className={`profile-setup-banner is-${status}`}
      role="status"
    >
      <div className="profile-setup-banner-icon">
        {status === 'rejected' ? <ShieldAlert size={19} /> : <BadgeCheck size={19} />}
      </div>
      <div className="profile-setup-banner-body">
        <b>
          {status === 'rejected'
            ? 'Your verification was not approved'
            : needsProfile
              ? 'Verify your student identity'
              : 'Verify your student identity'}
        </b>
        <span>
          {status === 'rejected'
            ? profile.verificationReason ||
              'Review the reason and submit again to unlock premium materials.'
            : needsProfile
              ? 'Finish your profile, then submit your student ID or admission letter. Downloads stay locked until the library verifies you.'
              : 'Submit your student ID or admission letter. Downloads stay locked until the library verifies you.'}
        </span>
      </div>
      <button
        type="button"
        className="primary profile-setup-banner-cta"
        onClick={() => navigate(needsProfile ? '/student/settings' : '/student/verification')}
      >
        {status === 'rejected' ? 'Submit again' : needsProfile ? 'Complete profile' : 'Verify now'}
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