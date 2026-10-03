// StudentSubscriptionTab — premium plan status and what is (or is not) unlocked.
import React, { useEffect, useState } from 'react';
import { BadgeCheck, Check, Clipboard, Copy, FileUp, Loader2, RefreshCw, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { fetchCatalogPlans, fetchMyPremiumSource, naira, type CatalogPlan } from '../lib/verification';
import {
  fetchMyPaymentRequests,
  fetchMyPaymentTransactions,
  fetchPaymentConfiguration,
  fetchPremiumPublicConfiguration,
  startAutomaticPayment,
  submitPaymentRequest,
  verifyAutomaticPayment,
  type PaymentConfiguration,
  type PaymentRequest,
  type PaymentTransaction,
  type PremiumPublicConfiguration
} from '../lib/payments';

export function StudentSubscriptionTab() {
  const { profile, plan, hasPremium, refreshEntitlement } = useAuth();
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfiguration | null>(null);
  const [premiumConfig, setPremiumConfig] = useState<PremiumPublicConfiguration | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [premiumSource, setPremiumSource] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [submittedAmount, setSubmittedAmount] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [automaticLoading, setAutomaticLoading] = useState(false);
  const [verifyingReference, setVerifyingReference] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetchCatalogPlans(),
      fetchPaymentConfiguration(),
      fetchPremiumPublicConfiguration(),
      fetchMyPaymentRequests(),
      fetchMyPaymentTransactions(),
      fetchMyPremiumSource()
    ])
      .then(([plansResult, configResult, premiumResult, requestsResult, transactionsResult, sourceResult]) => {
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
        if (premiumResult.status === 'fulfilled') setPremiumConfig(premiumResult.value);
        else setPaymentError(premiumResult.reason instanceof Error ? premiumResult.reason.message : 'Could not load Premium availability.');
        if (requestsResult.status === 'fulfilled') setPaymentRequests(requestsResult.value);
        else setPaymentError(requestsResult.reason instanceof Error ? requestsResult.reason.message : 'Could not load payment history.');
        if (transactionsResult.status === 'fulfilled') setTransactions(transactionsResult.value);
        else setPaymentError(transactionsResult.reason instanceof Error ? transactionsResult.reason.message : 'Could not load transaction history.');
        if (sourceResult.status === 'fulfilled') setPremiumSource(sourceResult.value);
        else setPaymentError(sourceResult.reason instanceof Error ? sourceResult.reason.message : 'Could not load entitlement source.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const verified = profile?.verificationStatus === 'verified';
  const status = profile?.verificationStatus ?? 'unsubmitted';
  const pendingRequest = paymentRequests.find((request) => request.status === 'pending');
  const selectedPlanInfo = plans.find((item) => item.slug === selectedPlan && item.is_premium);
  const premiumEnabled = premiumConfig?.enabled === true;
  const manualEnabled = premiumConfig?.manual_payment_enabled === true && paymentConfig?.manual_enabled === true;
  const automaticEnabled = premiumConfig?.automatic_payment_enabled === true && paymentConfig?.automatic_enabled === true;

  const handleSubmitPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedPlanInfo || !receipt || !manualEnabled || !paymentDate || !submittedAmount) return;
    setPaymentLoading(true);
    setPaymentError(null);
    try {
      await submitPaymentRequest({
        planSlug: selectedPlanInfo.slug,
        file: receipt,
        reference,
        paymentDate,
        submittedAmountKobo: Math.round(Number(submittedAmount) * 100)
      });
      setReceipt(null);
      setReference('');
      setPaymentDate(new Date().toISOString().slice(0, 10));
      setSubmittedAmount('');
      setPaymentRequests(await fetchMyPaymentRequests());
      setTransactions(await fetchMyPaymentTransactions());
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : 'Could not submit the payment request.');
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleAutomaticPayment = async (planSlug: string) => {
    setAutomaticLoading(true);
    setPaymentError(null);
    try {
      const checkoutUrl = await startAutomaticPayment(planSlug);
      window.location.assign(checkoutUrl);
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : 'Could not start the automatic payment.');
      setAutomaticLoading(false);
    }
  };

  const handleVerifyPayment = async (reference: string) => {
    setVerifyingReference(reference);
    setPaymentError(null);
    try {
      const status = await verifyAutomaticPayment(reference);
      setTransactions(await fetchMyPaymentTransactions());
      if (status === 'verified') {
        await refreshEntitlement();
        setPremiumSource(await fetchMyPremiumSource());
      } else if (status === 'pending') {
        setPaymentError('The provider has not confirmed this payment yet. You can check again shortly.');
      }
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : 'Could not verify this payment.');
    } finally {
      setVerifyingReference(null);
    }
  };

  const copyAccountDetail = async (field: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1800);
    } catch {
      setPaymentError('Could not copy that account detail. Select and copy it manually.');
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>Premium access</h1>
          <p>Downloads and full-text reading need a verified academic identity and an active plan.</p>
        </div>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => void Promise.all([
            refreshEntitlement(),
            fetchMyPaymentRequests().then(setPaymentRequests),
            fetchMyPaymentTransactions().then(setTransactions),
            fetchMyPremiumSource().then(setPremiumSource)
          ]).catch((cause) => setPaymentError(cause instanceof Error ? cause.message : 'Could not refresh payment status.'))}
        >
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
          <b>{hasPremium ? 'Premium is active' : !premiumEnabled ? 'Premium purchases are paused' : verified ? 'Verified — plan needed' : 'Verification needed first'}</b>
          <span>
            {hasPremium &&
              plan &&
              (plan.expires_at
                ? `You have ${plan.name} until ${new Date(plan.expires_at).toLocaleDateString('en-NG', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                  })}.`
                : `You have ${plan.name} with no scheduled expiration.`)}
            {!hasPremium && verified &&
              (premiumEnabled
                ? 'Your identity is confirmed. Choose an available payment option or ask the library to activate a plan.'
                : 'Your identity is confirmed. Premium purchases and Premium access are temporarily paused.')}
            {hasPremium && premiumSource === 'GLOBAL_PREMIUM' && ' Your access was granted by the library to all members; no payment was recorded.'}
            {hasPremium && premiumSource === 'PAYMENT' && ' Your access was activated after a verified payment.'}
            {hasPremium && premiumSource === 'ADMIN_GRANT' && ' Your access was granted by a library administrator.'}
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
            const current = hasPremium && plan?.slug === p.slug;
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
                ) : p.is_premium && verified && !hasPremium && premiumEnabled && (automaticEnabled || manualEnabled) && p.price_kobo > 0 ? (
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
                      ? !premiumEnabled
                        ? 'Premium purchases are temporarily paused.'
                        : automaticEnabled || manualEnabled
                          ? 'Contact the library office to have this plan activated on your account.'
                          : 'Payment options are not currently available.'
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

      {verified && !hasPremium && premiumEnabled && selectedPlanInfo && (automaticEnabled || manualEnabled) && (
        <section className="card payment-student-card" aria-labelledby="manual-payment-title">
          <div className="payment-section-heading">
            <div>
              <h3 id="manual-payment-title">Choose a payment method</h3>
              <p>Automatic payments are verified by the provider. Bank transfer receipts require library approval.</p>
            </div>
            <span className={`payment-status-pill is-${pendingRequest ? 'pending' : 'required'}`}>
              {pendingRequest ? 'Payment under review' : 'Payment required'}
            </span>
          </div>

          {paymentError && <p className="inline-notice is-error" role="alert">{paymentError}</p>}
          {automaticEnabled && (
            <div className="payment-method-option">
              <div><b>Automatic payment</b><span>Secure checkout with Paystack. Access activates after server verification.</span></div>
              <button
                type="button"
                className="primary"
                onClick={() => void handleAutomaticPayment(selectedPlanInfo.slug)}
                disabled={automaticLoading || paymentLoading}
              >
                {automaticLoading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {automaticLoading ? 'Opening secure checkout…' : `Pay ${naira(selectedPlanInfo.price_kobo, paymentConfig?.currency)}`}
              </button>
            </div>
          )}
          {manualEnabled ? (
            <>
              <div className="payment-instructions-grid">
                <div><span>Plan</span><b>{selectedPlanInfo.name}</b></div>
                <div><span>Amount</span><b>{naira(selectedPlanInfo.price_kobo, paymentConfig.currency)}</b></div>
                <div className="payment-copy-detail">
                  <span>Bank</span><b>{paymentConfig.bank_name}</b>
                  <button type="button" className="secondary-btn" onClick={() => void copyAccountDetail('bank', paymentConfig.bank_name)}>
                    {copiedField === 'bank' ? <Clipboard size={15} /> : <Copy size={15} />}
                    {copiedField === 'bank' ? 'Copied' : 'Copy bank'}
                  </button>
                </div>
                <div className="payment-copy-detail">
                  <span>Account name</span><b>{paymentConfig.account_name}</b>
                  <button type="button" className="secondary-btn" onClick={() => void copyAccountDetail('account-name', paymentConfig.account_name)}>
                    {copiedField === 'account-name' ? <Clipboard size={15} /> : <Copy size={15} />}
                    {copiedField === 'account-name' ? 'Copied' : 'Copy name'}
                  </button>
                </div>
                <div className="payment-account-number">
                  <span>Account number</span>
                  <b>{paymentConfig.account_number}</b>
                  <button type="button" className="secondary-btn" onClick={() => void copyAccountDetail('account-number', paymentConfig.account_number)}>
                    {copiedField === 'account-number' ? <Clipboard size={15} /> : <Copy size={15} />}
                    {copiedField === 'account-number' ? 'Copied' : 'Copy account number'}
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
                    Amount transferred ({paymentConfig?.currency})
                    <input
                      className="form-input"
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      value={submittedAmount}
                      onChange={(event) => setSubmittedAmount(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Transfer date
                    <input
                      className="form-input"
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      value={paymentDate}
                      onChange={(event) => setPaymentDate(event.target.value)}
                      required
                    />
                  </label>
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
                  <button type="submit" className="primary" disabled={!receipt || !submittedAmount || !paymentDate || paymentLoading || !manualEnabled}>
                    {paymentLoading ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
                    {paymentLoading ? 'Uploading and submitting…' : 'Submit receipt for review'}
                  </button>
                </form>
              )}
            </>
          ) : null}
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
        {transactions.length > 0 && (
          <ul className="payment-history-list">
            {transactions.map((transaction) => (
              <li key={transaction.id}>
                <div>
                  <b>{transaction.provider.toUpperCase()} · {naira(transaction.amount_kobo, transaction.currency)}</b>
                  <span>{transaction.payment_reference} · Started {new Date(transaction.created_at).toLocaleString('en-NG')}</span>
                  {transaction.expires_at && <span>Premium until {new Date(transaction.expires_at).toLocaleDateString('en-NG')}</span>}
                  {transaction.failure_reason && <span className="payment-rejection-reason">{transaction.failure_reason}</span>}
                </div>
                <div className="payment-history-status">
                  <span className={`payment-status-pill is-${transaction.status === 'verified' ? 'approved' : transaction.status}`}>
                    {transaction.status === 'verified' ? 'verified' : transaction.status}
                  </span>
                  {transaction.payment_method === 'automatic' && transaction.status === 'pending' && (
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => void handleVerifyPayment(transaction.payment_reference)}
                      disabled={verifyingReference !== null}
                    >
                      {verifyingReference === transaction.payment_reference
                        ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                        : <RefreshCw size={14} aria-hidden="true" />}
                      Check payment
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="plan-rules-heading">
        <h3 id="plan-rules-heading">How premium access works</h3>
        <ul className="plan-rules">
          <li>Verification confirms you are a registered FUW student. It never checks your email.</li>
          <li>Manual transfers require library approval. Automatic payments activate only after server-side provider verification.</li>
          <li>Premium requires both: a verified identity <em>and</em> an active plan.</li>
          <li>Catalogue browsing, previews and study tools stay free and open to everyone.</li>
        </ul>
      </section>
    </>
  );
}

export default StudentSubscriptionTab;