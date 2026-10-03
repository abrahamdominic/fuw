import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CreditCard, ExternalLink, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { useToast } from '../components/Toast';
import { ConfirmDialog, type ConfirmDialogState } from '../components/ConfirmDialog';
import { fetchCatalogPlans, naira, type CatalogPlan } from '../lib/verification';
import {
  EMPTY_PAYMENT_CONFIGURATION,
  fetchPaymentConfiguration,
  fetchPaymentRequests,
  getPaymentReceiptUrl,
  PAYMENT_CURRENCIES,
  reviewPaymentRequest,
  savePaymentConfiguration,
  type AdminPaymentRequest,
  type PaymentConfiguration
} from '../lib/payments';

const PAGE_SIZE = 30;
type Decision = 'approved' | 'rejected';

export function PaymentsAdminTab() {
  const { toast } = useToast();
  const [tab, setTab] = useState<'payments' | 'configuration'>('payments');
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [configuration, setConfiguration] = useState<PaymentConfiguration>(EMPTY_PAYMENT_CONFIGURATION);
  const [premiumSlug, setPremiumSlug] = useState('premium');
  const [price, setPrice] = useState('');
  const [requests, setRequests] = useState<AdminPaymentRequest[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [planId, setPlanId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminPaymentRequest | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [confirm, setConfirm] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => undefined
  });
  const listRequestId = useRef(0);

  const loadSettings = useCallback(async () => {
    const [config, catalog] = await Promise.all([fetchPaymentConfiguration(), fetchCatalogPlans()]);
    setConfiguration(config);
    setPlans(catalog);
    const premium = catalog.find((item) => item.is_premium);
    if (premium) {
      setPremiumSlug(premium.slug);
      setPrice((premium.price_kobo / 100).toFixed(2));
    }
  }, []);

  const loadRequests = useCallback(async (pageOffset: number, append = false) => {
    const requestId = ++listRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPaymentRequests({
        query,
        status,
        planId: planId || null,
        fromDate: fromDate || null,
        toDate: toDate || null,
        limit: PAGE_SIZE,
        offset: pageOffset
      });
      if (requestId !== listRequestId.current) return;
      setRequests((current) => append ? [...current, ...result] : result);
      if (result[0]) setTotal(Number(result[0].total_count));
      else if (!append) setTotal(0);
      setOffset(pageOffset + result.length);
    } catch (cause) {
      if (requestId === listRequestId.current) {
        setError(cause instanceof Error ? cause.message : 'Could not load payment submissions.');
        if (!append) setRequests([]);
      }
    } finally {
      if (requestId === listRequestId.current) setLoading(false);
    }
  }, [fromDate, planId, query, status]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSettings(), loadRequests(0)])
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load payment administration.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Initial load only; request filters have their own effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRequests(0), 250);
    return () => window.clearTimeout(timer);
  }, [loadRequests]);

  const updateConfiguration = (patch: Partial<PaymentConfiguration>) => {
    setConfiguration((current) => ({ ...current, ...patch }));
  };

  const saveConfiguration = async (event: React.FormEvent) => {
    event.preventDefault();
    const priceKobo = Math.round(Number(price) * 100);
    setSaving(true);
    setError(null);
    try {
      await savePaymentConfiguration(configuration, premiumSlug, priceKobo);
      toast('Payment instructions and premium pricing saved.', 'success');
      await loadSettings();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save payment settings.');
    } finally {
      setSaving(false);
    }
  };

  const openReceipt = async (request: AdminPaymentRequest) => {
    const receiptWindow = window.open('', '_blank', 'noopener,noreferrer');
    try {
      const url = await getPaymentReceiptUrl(request.receipt_path);
      if (receiptWindow) receiptWindow.location.href = url;
      else setError('Your browser blocked the receipt window. Allow pop-ups and try again.');
    } catch (cause) {
      receiptWindow?.close();
      setError(cause instanceof Error ? cause.message : 'Could not open the private receipt.');
    }
  };

  const submitDecision = async (request: AdminPaymentRequest, next: Decision, reason?: string) => {
    setBusy(true);
    setError(null);
    try {
      await reviewPaymentRequest(request.id, next, reason);
      toast(next === 'approved' ? 'Payment approved and premium access activated.' : 'Payment rejected.', 'success');
      setSelected(null);
      setDecision(null);
      setRejectionReason('');
      await loadRequests(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record the payment decision.');
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  const requestApproval = (request: AdminPaymentRequest) => {
    setConfirm({
      open: true,
      title: 'Approve this payment?',
      message: `This will grant ${request.plan_name} to ${request.student_name || request.student_email || 'this student'} and activate the existing premium entitlement.`,
      confirmLabel: 'Approve and activate',
      onConfirm: () => submitDecision(request, 'approved')
    });
  };

  return (
    <div className="payment-admin-page">
      <div className="page-head">
        <div className="page-head-text">
          <h1>Premium payments</h1>
          <p>Review private receipt submissions and manage bank transfer instructions.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => void Promise.all([loadSettings(), loadRequests(0)])}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>

      <div className="payment-admin-tabs" role="tablist" aria-label="Payment administration">
        <button type="button" role="tab" aria-selected={tab === 'payments'} onClick={() => setTab('payments')}>
          <CreditCard size={15} /> Submissions
        </button>
        <button type="button" role="tab" aria-selected={tab === 'configuration'} onClick={() => setTab('configuration')}>
          Payment configuration
        </button>
      </div>
      {error && <p className="inline-notice is-error" role="alert">{error}</p>}

      {tab === 'configuration' ? (
        <form className="card payment-config-form" onSubmit={(event) => void saveConfiguration(event)}>
          <div className="payment-config-intro">
            <h2>Payment methods</h2>
            <p>Configure manual bank transfers and Paystack checkout. Manual instructions are shown to verified students.</p>
          </div>
          <label className="payment-config-toggle">
            <input
              type="checkbox"
              checked={configuration.manual_enabled}
              onChange={(event) => updateConfiguration({
                active: event.target.checked,
                manual_enabled: event.target.checked
              })}
            />
            Accept manual payment submissions
          </label>
          <label className="payment-config-toggle">
            <input
              type="checkbox"
              checked={configuration.automatic_enabled}
              onChange={(event) => updateConfiguration({ automatic_enabled: event.target.checked })}
            />
            Accept automatic Paystack payments
          </label>
          <p className="muted-row">
            Automatic checkout requires the server-side <code>PAYSTACK_SECRET_KEY</code> secret to be configured before enabling it.
          </p>
          <div className="payment-config-grid">
            <label>Bank name<input className="form-input" value={configuration.bank_name} onChange={(event) => updateConfiguration({ bank_name: event.target.value })} maxLength={120} required={configuration.manual_enabled} /></label>
            <label>Account name<input className="form-input" value={configuration.account_name} onChange={(event) => updateConfiguration({ account_name: event.target.value })} maxLength={160} required={configuration.manual_enabled} /></label>
            <label>Account number<input className="form-input" value={configuration.account_number} onChange={(event) => updateConfiguration({ account_number: event.target.value })} maxLength={40} inputMode="numeric" required={configuration.manual_enabled} /></label>
            <label>Currency
              <select className="form-input" value={configuration.currency} onChange={(event) => updateConfiguration({ currency: event.target.value as PaymentConfiguration['currency'] })}>
                {PAYMENT_CURRENCIES.map((currency) => <option value={currency} key={currency}>{currency}</option>)}
              </select>
            </label>
            <label>Premium plan
              <select className="form-input" value={premiumSlug} onChange={(event) => setPremiumSlug(event.target.value)}>
                {plans.filter((item) => item.is_premium).map((item) => <option value={item.slug} key={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Premium price ({configuration.currency})
              <input className="form-input" type="number" min="0.01" max="1000000" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} required />
            </label>
            <label className="payment-config-wide">Payment instructions
              <textarea className="form-textarea" rows={4} value={configuration.instructions} onChange={(event) => updateConfiguration({ instructions: event.target.value })} maxLength={4000} />
            </label>
            <label>Reference field label
              <input className="form-input" value={configuration.reference_label} onChange={(event) => updateConfiguration({ reference_label: event.target.value })} maxLength={80} />
            </label>
            <label className="payment-config-toggle payment-config-wide">
              <input type="checkbox" checked={configuration.require_reference} onChange={(event) => updateConfiguration({ require_reference: event.target.checked })} />
              Require a transfer reference from students
            </label>
            <label className="payment-config-wide">Additional information
              <textarea className="form-textarea" rows={3} value={configuration.other_information} onChange={(event) => updateConfiguration({ other_information: event.target.value })} maxLength={2000} />
            </label>
          </div>
          <button type="submit" className="primary" disabled={saving || plans.length === 0}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {saving ? 'Saving…' : 'Save payment configuration'}
          </button>
        </form>
      ) : (
        <section className="payment-admin-list">
          <div className="payment-admin-filters">
            <label className="payment-admin-search">
              <Search size={17} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search student, email, matric, plan, reference…" aria-label="Search payment requests" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear payment search"><X size={15} /></button>}
            </label>
            <select className="form-input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Filter by payment status">
              <option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
            </select>
            <select className="form-input" value={planId} onChange={(event) => setPlanId(event.target.value)} aria-label="Filter by plan">
              <option value="">All plans</option>{plans.filter((item) => item.is_premium).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <label>From<input className="form-input" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
            <label>To<input className="form-input" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
          </div>
          <p className="payment-results-count" role="status">{total} payment{total === 1 ? '' : 's'} found</p>
          {loading && requests.length === 0 ? (
            <p className="muted-row" role="status"><Loader2 size={15} className="animate-spin" /> Loading payments…</p>
          ) : requests.length === 0 ? (
            <div className="card payment-empty-state">No payment submissions match these filters.</div>
          ) : (
            <>
              <ul className="payment-admin-requests">
                {requests.map((request) => (
                  <li key={request.id} className="payment-admin-request">
                    <div className="payment-admin-request-main">
                      <div className="payment-admin-request-title">
                        <b>{request.student_name || 'Student'}</b>
                        <span className={`payment-status-pill is-${request.status}`}>{request.status}</span>
                      </div>
                      <span>{request.student_email || 'No email'} · Matric {request.student_matric_number || '—'}</span>
                      <span>{request.plan_name} · Expected {naira(request.amount_kobo, request.currency)}
                        {request.submitted_amount_kobo != null && ` · Reported ${naira(request.submitted_amount_kobo, request.currency)}`}
                        {` · ${new Date(request.created_at).toLocaleString('en-NG')}`}
                      </span>
                      {request.payment_date && <span>Transfer date: {new Date(`${request.payment_date}T00:00:00`).toLocaleDateString('en-NG')} · Method: {request.payment_method || 'bank transfer'}</span>}
                      {request.payment_reference && <span>Reference: {request.payment_reference}</span>}
                      {request.rejection_reason && <span className="payment-rejection-reason">Rejection: {request.rejection_reason}</span>}
                    </div>
                    <div className="payment-admin-actions">
                      <button type="button" className="secondary-btn" onClick={() => { setSelected(request); setDecision(null); }}>
                        Review receipt
                      </button>
                      {request.status === 'pending' && (
                        <>
                          <button type="button" className="primary" onClick={() => requestApproval(request)} disabled={busy}>Approve</button>
                          <button type="button" className="danger-btn" onClick={() => { setSelected(request); setDecision('rejected'); }} disabled={busy}>Reject</button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {offset < total && (
                <button type="button" className="secondary-btn payment-load-more" onClick={() => void loadRequests(offset, true)} disabled={loading}>
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              )}
            </>
          )}
        </section>
      )}

      {selected && (
        <div className="modal-overlay" role="presentation" onClick={() => setSelected(null)}>
          <section className="protected-modal payment-review-modal" role="dialog" aria-modal="true" aria-labelledby="payment-review-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="payment-review-title">Review payment</h2>
            <p><b>{selected.student_name || 'Student'}</b><br />{selected.student_email || 'No email'} · {selected.student_matric_number || 'No matric number'}</p>
            <p>
              {selected.plan_name} · Expected {naira(selected.amount_kobo, selected.currency)}
              {selected.submitted_amount_kobo != null && <> · Reported {naira(selected.submitted_amount_kobo, selected.currency)}</>}
              <br />Submitted {new Date(selected.created_at).toLocaleString('en-NG')}
              {selected.payment_date && <><br />Transfer date {new Date(`${selected.payment_date}T00:00:00`).toLocaleDateString('en-NG')}</>}
              {selected.payment_method && <> · {selected.payment_method.replaceAll('_', ' ')}</>}
            </p>
            {selected.payment_reference && <p>Reference: {selected.payment_reference}</p>}
            <button type="button" className="secondary-btn" onClick={() => void openReceipt(selected)}>
              <ExternalLink size={15} /> View private receipt
            </button>
            {decision === 'rejected' && (
              <label>Reason for rejection
                <textarea className="form-textarea" rows={3} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} maxLength={1000} required />
              </label>
            )}
            <div className="payment-admin-actions">
              {selected.status === 'pending' && !decision && <button type="button" className="danger-btn" onClick={() => setDecision('rejected')}>Reject</button>}
              {decision === 'rejected' && <button type="button" className="danger-btn" onClick={() => void submitDecision(selected, 'rejected', rejectionReason)} disabled={busy || !rejectionReason.trim()}>{busy ? 'Saving…' : 'Confirm rejection'}</button>}
              <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </section>
        </div>
      )}
      <ConfirmDialog {...confirm} onClose={() => setConfirm((current) => ({ ...current, open: false }))} />
    </div>
  );
}
