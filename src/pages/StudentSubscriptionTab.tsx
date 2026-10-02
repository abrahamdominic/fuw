// StudentSubscriptionTab — premium plan status and what is (or is not) unlocked.
import React, { useEffect, useState } from 'react';
import { BadgeCheck, Check, Clipboard, Copy, FileUp, Loader2, RefreshCw, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { fetchCatalogPlans, naira, type CatalogPlan } from '../lib/verification';
import {
  fetchMyPaymentRequests,
  fetchPaymentConfiguration,
  submitPaymentRequest,
  type PaymentConfiguration,
  type PaymentRequest
} from '../lib/payments';

export function StudentSubscriptionTab() {
  const { profile, plan, hasPremium, refreshEntitlement } = useAuth();
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfiguration | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchCatalogPlans(), fetchPaymentConfiguration(), fetchMyPaymentRequests()])
      .then(([plansResult, configResult, requestsResult]) => {
        if (cancelled) return;
        if (plansResult.status === 'fulfilled') {
          setPlans(plansResult.value);
          const premiumPlan = plansResult.value.find((item) => item.is_premium && item.price_kobo > 0);
          if (premiumPlan) setSelectedPlan(premiumPlan.slug);
        } else {
          setPaymentError(plansResult.reason instanceof Error ? plansResult.reason.message : 'Could not load premium plans.');
        }
        if (configResult.status === 'fulfilled') setPaymentConfig(configResult.value);
        else setPaymentError(configResult.reason instanceof Error ? configResult.reason.message : 'Could not load payment instructions.');
        if (requestsResult.status === 'fulfilled') setPaymentRequests(requestsResult.value);
        else setPaymentError(requestsResult.reason instanceof Error ? requestsResult.reason.message : 'Could not load payment history.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const verified = profile?.verificationStatus === 'verified';
  const status = profile?.verificationStatus ?? 'unsubmitted';
  const pendingRequest = paymentRequests.find((request) => request.status === 'pending');
  const selectedPlanInfo = plans.find((item) => item.slug === selectedPlan && item.is_premium);

  const handleSubmitPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedPlanInfo || !receipt || !paymentConfig?.active) return;
    setPaymentLoading(true);
    setPaymentError(null);
    try {
      await submitPaymentRequest({ planSlug: selectedPlanInfo.slug, file: receipt, reference });
      setReceipt(null);
      setReference('');
      setPaymentRequests(await fetchMyPaymentRequests());
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : 'Could not submit the payment request.');
    } finally {
      setPaymentLoading(false);
    }
  };

  const copyAccountNumber = async () => {
    if (!paymentConfig?.account_number) return;
    try {
      await navigator.clipboard.writeText(paymentConfig.account_number);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setPaymentError('Could not copy the account number. Select and copy it manually.');
    }
  };

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
                  {p.price_kobo === 0 ? 'Free' : naira(p.price_kobo, p.currency)}
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
                ) : p.is_premium && verified && !hasPremium && p.price_kobo > 0 ? (
                  <button
                    type="button"
                    className={selectedPlan === p.slug ? 'primary' : 'secondary-btn'}
                    onClick={() => setSelectedPlan(p.slug)}
                    aria-pressed={selectedPlan === p.slug}
                  >
                    {selectedPlan === p.slug ? 'Selected for payment' : 'Choose this plan'}
                  </button>
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

      {verified && !hasPremium && selectedPlanInfo && (
        <section className="card payment-student-card" aria-labelledby="manual-payment-title">
          <div className="payment-section-heading">
            <div>
              <h3 id="manual-payment-title">Pay by bank transfer</h3>
              <p>Transfer the exact amount, then upload your receipt for manual verification.</p>
            </div>
            <span className={`payment-status-pill is-${pendingRequest ? 'pending' : 'required'}`}>
              {pendingRequest ? 'Payment under review' : 'Payment required'}
            </span>
          </div>

          {paymentError && <p className="inline-notice is-error" role="alert">{paymentError}</p>}
          {!paymentConfig?.active ? (
            <p className="muted-row">Manual payment is not currently available. Please check back later.</p>
          ) : (
            <>
              <div className="payment-instructions-grid">
                <div><span>Plan</span><b>{selectedPlanInfo.name}</b></div>
                <div><span>Amount</span><b>{naira(selectedPlanInfo.price_kobo, paymentConfig.currency)}</b></div>
                <div><span>Bank</span><b>{paymentConfig.bank_name}</b></div>
                <div><span>Account name</span><b>{paymentConfig.account_name}</b></div>
                <div className="payment-account-number">
                  <span>Account number</span>
                  <b>{paymentConfig.account_number}</b>
                  <button type="button" className="secondary-btn" onClick={() => void copyAccountNumber()}>
                    {copied ? <Clipboard size={15} /> : <Copy size={15} />}
                    {copied ? 'Copied' : 'Copy account number'}
                  </button>
                </div>
              </div>
              {(paymentConfig.instructions || paymentConfig.other_information) && (
                <div className="payment-instructions-text">
                  {paymentConfig.instructions && <p>{paymentConfig.instructions}</p>}
                  {paymentConfig.other_information && <p>{paymentConfig.other_information}</p>}
                </div>
              )}
              {pendingRequest ? (
                <p className="inline-notice" role="status">
                  Your receipt was submitted on {new Date(pendingRequest.created_at).toLocaleDateString('en-NG')}. The library will notify you after review.
                </p>
              ) : (
                <form className="payment-receipt-form" onSubmit={(event) => void handleSubmitPayment(event)}>
                  <label>
                    {paymentConfig.reference_label || 'Payment reference'}{paymentConfig.require_reference ? '' : ' (optional)'}
                    <input
                      className="form-input"
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      maxLength={120}
                      required={paymentConfig.require_reference}
                    />
                  </label>
                  <label className="payment-receipt-picker">
                    <span>Payment receipt (JPG, PNG or PDF; max 8 MB)</span>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                      onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
                      aria-label="Choose payment receipt"
                    />
                  </label>
                  {receipt && (
                    <div className="payment-selected-file">
                      <FileUp size={16} aria-hidden="true" />
                      <span>{receipt.name} · {(receipt.size / (1024 * 1024)).toFixed(2)} MB</span>
                      <button type="button" onClick={() => setReceipt(null)} aria-label="Remove selected receipt">
                        <X size={15} />
                      </button>
                    </div>
                  )}
                  <button type="submit" className="primary" disabled={!receipt || paymentLoading || !paymentConfig.active}>
                    {paymentLoading ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
                    {paymentLoading ? 'Uploading and submitting…' : 'Submit receipt for review'}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      )}

      <section className="card payment-history-card" aria-labelledby="payment-history-heading">
        <h3 id="payment-history-heading">Payment history</h3>
        {loading ? <p className="muted-row" role="status">Loading payment history…</p> :
          paymentRequests.length === 0 ? <p className="muted-row">You have not submitted a premium payment.</p> :
            <ul className="payment-history-list">
              {paymentRequests.map((request) => (
                <li key={request.id}>
                  <div>
                    <b>{request.plan?.name ?? 'Premium plan'} · {naira(request.amount_kobo, request.currency)}</b>
                    <span>Submitted {new Date(request.created_at).toLocaleString('en-NG')}</span>
                    {request.payment_reference && <span>Reference: {request.payment_reference}</span>}
                    {request.rejection_reason && <span className="payment-rejection-reason">Reason: {request.rejection_reason}</span>}
                  </div>
                  <span className={`payment-status-pill is-${request.status}`}>{request.status}</span>
                </li>
              ))}
            </ul>
        }
      </section>

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