// StudentSubscriptionTab — premium plan status and what is (or is not) unlocked.
import React, { useEffect, useState } from 'react';
import { BadgeCheck, Check, Loader2, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { fetchCatalogPlans, naira, type CatalogPlan } from '../lib/verification';

export function StudentSubscriptionTab() {
  const { profile, plan, hasPremium, refreshEntitlement } = useAuth();
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCatalogPlans()
      .then(setPlans)
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
  }, []);

  const verified = profile?.verificationStatus === 'verified';
  const status = profile?.verificationStatus ?? 'unsubmitted';

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>Premium access</h1>
          <p>Downloads and full-text reading need a verified academic identity and an active plan.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => void refreshEntitlement()}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>

      <section
        className={`verify-status-card is-${hasPremium ? 'verified' : verified ? 'pending' : 'unsubmitted'}`}
        aria-live="polite"
      >
        <span className="verify-status-icon" aria-hidden="true">
          {hasPremium ? <BadgeCheck size={24} /> : verified ? <Sparkles size={24} /> : <ShieldAlert size={24} />}
        </span>
        <div className="verify-status-body">
          <b>{hasPremium ? 'Premium is active' : verified ? 'Verified — plan needed' : 'Verification needed first'}</b>
          <span>
            {hasPremium &&
              plan &&
              `You have ${plan.name} until ${new Date(plan.expires_at).toLocaleDateString('en-NG', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
              })}.`}
            {!hasPremium && verified &&
              'Your identity is confirmed. Ask the library to activate a plan to unlock downloads.'}
            {!verified &&
              'Premium can only be unlocked after the library verifies your academic identity. Nothing is charged automatically.'}
          </span>
        </div>
      </section>

      {status === 'rejected' && profile?.verificationReason && (
        <p className="inline-notice is-error" role="alert">
          Verification was not approved: {profile.verificationReason}
        </p>
      )}
      {error && (
        <p className="inline-notice is-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="card" role="status">
          <p className="muted-row">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading plans…
          </p>
        </div>
      ) : (
        <div className="plan-grid">
          {plans.map((p) => {
            const current = plan?.slug === p.slug;
            return (
              <section key={p.id} className={`plan-card ${p.is_premium ? 'is-premium' : ''} ${current ? 'is-current' : ''}`}>
                {p.is_premium && <span className="plan-ribbon">Most complete</span>}
                <h3>{p.name}</h3>
                <p className="plan-price">
                  {p.price_kobo === 0 ? 'Free' : naira(p.price_kobo)}
                  {p.price_kobo > 0 && <span className="muted"> / {p.duration_days} days</span>}
                </p>
                {p.description && <p className="plan-desc">{p.description}</p>}
                <ul className="plan-features">
                  {p.features.map((f) => (
                    <li key={f}>
                      <Check size={14} aria-hidden="true" /> {f}
                    </li>
                  ))}
                </ul>
                {current ? (
                  <p className="plan-current">
                    <BadgeCheck size={14} aria-hidden="true" /> Your current plan
                  </p>
                ) : (
                  <p className="plan-cta-hint">
                    {p.is_premium
                      ? 'Contact the library office to have this plan activated on your account.'
                      : 'Included with every account.'}
                  </p>
                )}
              </section>
            );
          })}
          {plans.length === 0 && (
            <p className="muted-row">No plans are published yet.</p>
          )}
        </div>
      )}

      <section className="card" aria-labelledby="plan-rules-heading">
        <h3 id="plan-rules-heading">How premium access works</h3>
        <ul className="plan-rules">
          <li>Verification confirms you are a registered FUW student. It never checks your email.</li>
          <li>A plan is granted by a library administrator. There is no automatic payment or auto-renewal.</li>
          <li>Premium requires both: a verified identity <em>and</em> an active plan.</li>
          <li>Catalogue browsing, previews and study tools stay free and open to everyone.</li>
        </ul>
      </section>
    </>
  );
}

export default StudentSubscriptionTab;