import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';

const DISMISS_KEY = 'fuw:profileSetupBannerHidden';

export function ProfileSetupBanner() {
  const navigate = useNavigate();
  const { isProfileComplete } = useAuth();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (isProfileComplete || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Storage unavailable — non-critical, just leave the banner visible.
    }
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
        aria-label="Dismiss profile setup notice"
        onClick={dismiss}
      >
        <X size={16} />
      </button>
    </div>
  );
}