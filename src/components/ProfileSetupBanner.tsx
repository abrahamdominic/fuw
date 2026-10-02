// ProfileSetupBanner — reminds an incomplete-profile student to finish setup.
//
// The reminder must come back on every sign-in, so dismissal is scoped to the
// current session only (sessionStorage). A localStorage flag here would hide the
// notice permanently and leave students with unusable accounts.
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { dismissReminder, reminderDismissed } from '../lib/reminders';

export function ProfileSetupBanner() {
  const navigate = useNavigate();
  const { isProfileComplete, user } = useAuth();
  const [hidden, setHidden] = useState(false);

  // Read the dismissal after mount so the banner does not flash for students who
  // already closed it earlier in this session.
  useEffect(() => {
    setHidden(reminderDismissed('profile-setup', user?.id));
  }, [user?.id]);

  if (isProfileComplete || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    // Session-scoped and account-scoped: signing out clears it, so the next
    // sign-in reminds the student again.
    dismissReminder('profile-setup', user?.id);
  };

  return (
    <div className="profile-setup-banner" role="status">
      <div className="profile-setup-banner-icon">
        <AlertTriangle size={19} />
      </div>
      <div className="profile-setup-banner-body">
        <b>Complete your student profile</b>
        <span>Add your matric number, faculty and department so your submissions and catalogue recommendations are accurate.</span>
      </div>
      <button
        type="button"
        className="primary profile-setup-banner-cta"
        onClick={() => navigate('/student/settings')}
      >
        Complete profile <ArrowRight size={15} />
      </button>
      <button
        type="button"
        className="profile-setup-banner-close"
        aria-label="Dismiss profile setup notice for this session"
        onClick={dismiss}
      >
        <X size={16} />
      </button>
    </div>
  );
}