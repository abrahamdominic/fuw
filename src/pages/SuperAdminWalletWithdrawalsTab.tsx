import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  KeyRound,
  Landmark,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle
} from 'lucide-react';
import { requireSupabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { naira } from '../lib/verification';
import { fx, staggerDelay } from '../lib/motion';

const PAGE_SIZE = 25;

type WithdrawalStatus = 'pending' | 'processing' | 'successful' | 'failed' | 'reversed';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'successful', label: 'Successful' },
  { value: 'failed', label: 'Failed' },
  { value: 'reversed', label: 'Reversed (refunded)' }
];

const STATUS_BADGE: Record<WithdrawalStatus, string> = {
  pending: 'pending',
  processing: 'pending',
  successful: 'approved',
  failed: 'rejected',
  reversed: 'inactive'
};

const STATUS_LABEL: Record<WithdrawalStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  successful: 'Successful',
  failed: 'Failed',
  reversed: 'Reversed'
};

/**
 * Row shape produced by `fuw_admin_list_withdrawals`. Every field is server
 * rendered — the client never derives a status, a URL or an amount.
 */
interface AdminWithdrawal {
  id: string;
  user_id: string;
  amount_kobo: number;
  fee_kobo: number;
  net_amount_kobo: number;
  currency: string;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  status: WithdrawalStatus;
  reference: string | null;
  provider: string | null;
  provider_transfer_code: string | null;
  provider_approval_url: string | null;
  provider_authorization_code: string | null;
  provider_status: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string | null;
  processed_at: string | null;
  full_name: string | null;
  email: string | null;
  matric_number: string | null;
}

interface WithdrawalSummary {
  total_count: number;
  total_amount_kobo: number;
  total_fee_kobo: number;
  total_net_kobo: number;
  awaiting_otp_count: number;
  last_requested_at: string | null;
  by_status: Record<string, { count: number }>;
}

/**
 * Accepts only an absolute `https://` URL. Anything else — a relative path, a
 * `javascript:`/`data:` scheme, a malformed string, a credential-bearing URL —
 * returns null so the console shows "none on record" instead of rendering a
 * link. The value is never edited, padded or synthesised: if Paystack did not
 * send one, the column stays NULL in the database and absent here.
 */
export function safeApprovalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname) return null;
  return trimmed;
}

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatDate = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString('en-NG') : '-';

/**
 * Super-admin wallet withdrawal console.
 *
 * Every read goes through the `is_admin()`-guarded RPCs
 * (`fuw_admin_list_withdrawals`, `fuw_admin_withdrawal_summary`), and the only
 * state-changing action — finalising a Paystack transfer that is parked behind
 * an OTP — is delegated to the `wallet-paystack-withdraw` Edge Function, which
 * re-checks `is_super_admin()` server-side before calling Paystack. There is
 * deliberately no client-side approve/refund control: the browser cannot move
 * money, it can only ask the server to.
 */
export function SuperAdminWalletWithdrawalsTab() {
  const { toast } = useToast();

  const [rows, setRows] = useState<AdminWithdrawal[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<WithdrawalSummary | null>(null);
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // OTP finalisation state. The OTP itself lives only in this component's
  // state, is cleared on submit/close/unmount, and is never logged, persisted
  // or put into the URL.
  const [otpRowId, setOtpRowId] = useState<string | null>(null);
  const [otpValue, setOtpValue] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const requestId = useRef(0);

  const loadRows = useCallback(async (nextOffset: number, nextStatus: string) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await requireSupabase().rpc('fuw_admin_list_withdrawals', {
        p_status: nextStatus || null,
        p_limit: PAGE_SIZE,
        p_offset: nextOffset
      });
      if (rpcError) throw new Error(rpcError.message);
      if (id !== requestId.current) return;
      const items = Array.isArray(data?.withdrawals) ? data.withdrawals : [];
      setRows(items as AdminWithdrawal[]);
      setTotal(toNumber(data?.total));
      if (nextOffset > 0 && items.length === 0) {
        // The result set shrank under us (a filter change or a new record);
        // fall back to the first page rather than showing a blank panel.
        setOffset(0);
      }
    } catch (cause) {
      if (id !== requestId.current) return;
      setRows([]);
      setTotal(0);
      setError(cause instanceof Error ? cause.message : 'Could not load withdrawals.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const { data, error: rpcError } = await requireSupabase().rpc('fuw_admin_withdrawal_summary', {});
      if (rpcError) throw new Error(rpcError.message);
      setSummary(
        data && typeof data === 'object' && !Array.isArray(data) ? (data as WithdrawalSummary) : null
      );
      setSummaryError(null);
    } catch (cause) {
      setSummary(null);
      setSummaryError(cause instanceof Error ? cause.message : 'Totals unavailable.');
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows(0, status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  // Never retain an OTP across navigation or a row change.
  useEffect(() => {
    return () => {
      setOtpValue('');
    };
  }, []);

  const changeStatus = (next: string) => {
    setStatus(next);
    setOffset(0);
    setOtpRowId(null);
    setOtpValue('');
    setOtpError(null);
    void loadRows(0, next);
  };

  const refresh = () => {
    setOtpRowId(null);
    setOtpValue('');
    setOtpError(null);
    void loadRows(offset, status);
    void loadSummary();
  };

  const openOtp = (row: AdminWithdrawal) => {
    setOtpRowId(row.id);
    setOtpValue('');
    setOtpError(null);
  };

  const closeOtp = () => {
    setOtpRowId(null);
    setOtpValue('');
    setOtpError(null);
  };

  const finalizeTransfer = async (row: AdminWithdrawal) => {
    const transferCode = (row.provider_transfer_code || '').trim();
    const otp = otpValue.trim();
    if (!transferCode) {
      setOtpError('This withdrawal has no provider transfer code, so it cannot be finalised.');
      return;
    }
    if (!otp) {
      setOtpError('Enter the one-time password Paystack sent to the account owner.');
      return;
    }

    setOtpBusy(true);
    setOtpError(null);
    try {
      const { data, error: fnError } = await requireSupabase().functions.invoke(
        'wallet-paystack-withdraw',
        { body: { action: 'finalize_transfer', transferCode, otp } }
      );

      if (fnError) {
        let detail = fnError.message || 'Could not finalise the transfer.';
        try {
          const context = (fnError as { context?: Response }).context;
          const body = context ? await context.clone().json() : null;
          if (typeof body?.error === 'string') detail = body.error;
        } catch {
          // The function already carried a usable message.
        }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(String(data.error));

      toast(`Transfer finalised: Paystack reported "${String(data?.status ?? 'processed')}".`, 'success');
      closeOtp();
      await Promise.all([loadRows(offset, status), loadSummary()]);
    } catch (cause) {
      setOtpError(cause instanceof Error ? cause.message : 'Could not finalise the transfer.');
    } finally {
      // The OTP is single-use and must never outlive this attempt.
      setOtpValue('');
      setOtpBusy(false);
    }
  };

  const firstIndex = total === 0 ? 0 : offset + 1;
  const lastIndex = offset + rows.length;
  const canPrev = offset > 0;
  const canNext = offset + rows.length < total;

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns:
      'minmax(190px, 1.5fr) minmax(140px, 1fr) minmax(160px, 1.15fr) minmax(150px, 1.1fr) minmax(180px, 1.3fr) minmax(140px, 1fr) minmax(170px, 1.15fr)',
    minWidth: 1180
  };

  const summaryCards = [
    { icon: Banknote, value: summary ? summary.total_count.toLocaleString() : '-', label: 'Withdrawal requests' },
    {
      icon: Landmark,
      value: summary ? naira(toNumber(summary.total_amount_kobo)) : '-',
      label: 'Total amount requested'
    },
    { icon: CheckCircle2, value: summary ? naira(toNumber(summary.total_net_kobo)) : '-', label: 'Net paid out to students' },
    { icon: ShieldCheck, value: summary ? naira(toNumber(summary.total_fee_kobo)) : '-', label: 'Platform fees' },
    { icon: KeyRound, value: summary ? String(toNumber(summary.awaiting_otp_count)) : '-', label: 'Waiting for an OTP' }
  ];

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">WALLET SYSTEMS</p>
          <h1>Wallet withdrawals</h1>
          <p className="subtitle">
            Every bank payout requested from a student wallet. The list is read-only: transfers are
            created, reversed and finalised on the server, so nothing on this page can move money
            on its own.
          </p>
        </div>
        <button type="button" className="secondary-btn" onClick={refresh} disabled={loading || otpBusy}>
          <RefreshCw size={15} className={loading ? 'spin-icon' : undefined} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Totals — non-critical, so a summary failure degrades to a note. */}
      <div className="portal-stats admin-stats-grid">
        {summaryCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <section key={card.label} className={fx.fadeUp} style={staggerDelay(index, 50)}>
              <Icon />
              <b>{summaryLoading && !summary ? '…' : card.value}</b>
              <span>{card.label}</span>
            </section>
          );
        })}
      </div>
      {summaryError && (
        <p className="inline-notice is-error" role="alert">
          Totals could not be loaded: {summaryError}
        </p>
      )}

      <div className="admin-section-block">
        <div className="section-head">
          <div>
            <p className="kicker">PAYOUT QUEUE</p>
            <h2>Withdrawal requests</h2>
          </div>
          <div className="manage-tools compact" style={{ minWidth: 220 }}>
            <Banknote size={16} aria-hidden="true" />
            <label htmlFor="wallet-withdrawal-status" style={{ position: 'absolute', left: -9999 }}>
              Filter withdrawals by status
            </label>
            <select
              id="wallet-withdrawal-status"
              value={status}
              onChange={(event) => changeStatus(event.target.value)}
              disabled={loading}
              style={{
                border: 0,
                background: 'transparent',
                font: 'inherit',
                fontSize: 13,
                outline: 'none',
                width: '100%'
              }}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <div className="form-feedback-box error">
            <AlertCircle size={18} />
            <div>
              <p>{error}</p>
              <button type="button" className="secondary-btn" onClick={() => void loadRows(offset, status)}>
                <RefreshCw size={14} /> Try again
              </button>
            </div>
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="empty-state card-empty">
            <Loader2 size={28} className="spin-icon" />
            <b>Loading withdrawals…</b>
            <span>Fetching the payout queue from the server.</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state card-empty">
            <Banknote size={32} />
            <b>
              {status
                ? `No ${STATUS_OPTIONS.find((option) => option.value === status)?.label.toLowerCase()} withdrawals.`
                : 'No wallet withdrawals yet.'}
            </b>
            <span>
              {status
                ? 'Change the status filter above to see the rest of the payout queue.'
                : 'When students request a bank payout it will appear here for review.'}
            </span>
          </div>
        ) : (
          <>
            <p className="muted" role="status" style={{ margin: '0 0 10px' }}>
              Showing {firstIndex}–{lastIndex} of {total.toLocaleString()} withdrawal
              {total === 1 ? '' : 's'}
              {status ? ` · filtered to ${STATUS_OPTIONS.find((option) => option.value === status)?.label}` : ''}
            </p>

            <div className="table">
              <div className="tr head" style={gridStyle}>
                <span>Student</span>
                <span>Amount / fee / net</span>
                <span>Destination bank</span>
                <span>Status</span>
                <span>Reference &amp; transfer</span>
                <span>Timeline</span>
                <span>Action</span>
              </div>

              {rows.map((row) => {
                const approvalUrl = safeApprovalUrl(row.provider_approval_url);
                const awaitingOtp =
                  row.status === 'processing' &&
                  Boolean((row.provider_transfer_code || '').trim()) &&
                  row.provider_status === 'otp';
                const canFinalize =
                  row.status === 'processing' && Boolean((row.provider_transfer_code || '').trim());
                const isOpen = otpRowId === row.id;

                return (
                  <React.Fragment key={row.id}>
                    <div className="tr" style={gridStyle}>
                      <span>
                        <b>{row.full_name || 'Unnamed student'}</b>
                        <small>{row.email || 'No email on file'}</small>
                        {row.matric_number && <small>Matric {row.matric_number}</small>}
                      </span>

                      <span>
                        <b>{naira(toNumber(row.amount_kobo), row.currency || 'NGN')}</b>
                        <small>Fee {naira(toNumber(row.fee_kobo), row.currency || 'NGN')}</small>
                        <small>Net {naira(toNumber(row.net_amount_kobo), row.currency || 'NGN')}</small>
                      </span>

                      <span>
                        <b>{row.bank_name || '-'}</b>
                        <small>{row.account_number || '-'}</small>
                        <small>{row.account_name || '-'}</small>
                      </span>

                      <span>
                        <span className={`status-badge ${STATUS_BADGE[row.status] || 'pending'}`}>
                          {row.status === 'successful' ? <CheckCircle2 size={12} /> : row.status === 'processing' ? <Clock size={12} /> : <AlertCircle size={12} />}
                          {STATUS_LABEL[row.status] || row.status}
                        </span>
                        {row.provider_status && (
                          <small>
                            Paystack: {row.provider_status}
                            {awaitingOtp ? ' · OTP required' : ''}
                          </small>
                        )}
                        {row.failure_reason && (
                          <small style={{ color: '#b91c1c' }}>Reason: {row.failure_reason}</small>
                        )}
                      </span>

                      <span>
                        <small style={{ fontFamily: 'monospace' }}>{row.reference || '-'}</small>
                        <small style={{ fontFamily: 'monospace' }}>
                          {row.provider_transfer_code || 'No transfer code'}
                        </small>
                        {approvalUrl ? (
                          <small>
                            <a href={approvalUrl} target="_blank" rel="noreferrer noopener">
                              <ExternalLink size={12} /> Paystack approval URL
                            </a>
                          </small>
                        ) : (
                          <small>No approval URL on record</small>
                        )}
                      </span>

                      <span>
                        <small>Requested {formatDate(row.created_at)}</small>
                        <small>Processed {formatDate(row.processed_at)}</small>
                        <small>Updated {formatDate(row.updated_at)}</small>
                      </span>

                      <span className="admin-row-actions">
                        {canFinalize ? (
                          <button
                            type="button"
                            className={isOpen ? 'secondary-btn' : 'approval-btn approve small'}
                            onClick={() => (isOpen ? closeOtp() : openOtp(row))}
                            disabled={otpBusy}
                          >
                            <KeyRound size={13} />
                            {isOpen ? 'Cancel' : awaitingOtp ? 'Enter OTP' : 'Finalise transfer'}
                          </button>
                        ) : (
                          <small style={{ color: '#788c80' }}>No action available</small>
                        )}
                      </span>
                    </div>

                    {isOpen && (
                      <div className="tr" style={{ gridTemplateColumns: '1fr', minWidth: 1180 }}>
                        <div
                          className="maintenance-control-card"
                          style={{ display: 'block', padding: '14px 16px' }}
                        >
                          <b style={{ display: 'block', marginBottom: 4 }}>
                            <KeyRound size={14} /> Finalise Paystack transfer{' '}
                            <span style={{ fontFamily: 'monospace' }}>{row.provider_transfer_code}</span>
                          </b>
                          <p className="muted" style={{ margin: '0 0 10px' }}>
                            Paystack emails/SMS the one-time password to the registered account owner.
                            It is sent straight to Paystack from your browser and is never stored,
                            logged or added to this page&apos;s history.
                          </p>
                          <div className="manage-tools compact" style={{ maxWidth: 360 }}>
                            <input
                              value={otpValue}
                              onChange={(event) => setOtpValue(event.target.value.replace(/\s/g, ''))}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !otpBusy) void finalizeTransfer(row);
                                if (event.key === 'Escape') closeOtp();
                              }}
                              placeholder="Enter the OTP"
                              aria-label={`One-time password for transfer ${row.provider_transfer_code || row.reference || ''}`}
                              autoComplete="one-time-code"
                              inputMode="numeric"
                              disabled={otpBusy}
                              style={{ letterSpacing: '0.2em' }}
                            />
                          </div>
                          {otpError && (
                            <p className="inline-notice is-error" role="alert">
                              {otpError}
                            </p>
                          )}
                          <div className="admin-row-actions" style={{ marginTop: 10 }}>
                            <button
                              type="button"
                              className="primary"
                              onClick={() => void finalizeTransfer(row)}
                              disabled={otpBusy || !otpValue.trim()}
                            >
                              {otpBusy ? <Loader2 size={15} className="spin-icon" /> : <ShieldCheck size={15} />}
                              {otpBusy ? 'Finalising…' : 'Send OTP to Paystack'}
                            </button>
                            <button type="button" className="btn-secondary" onClick={closeOtp} disabled={otpBusy}>
                              <XCircle size={15} /> Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            <div className="admin-row-actions" style={{ marginTop: 14, justifyContent: 'space-between' }}>
              <span className="muted" role="status">
                Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </span>
              <span className="admin-row-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    const next = Math.max(0, offset - PAGE_SIZE);
                    setOffset(next);
                    setOtpRowId(null);
                    setOtpValue('');
                    void loadRows(next, status);
                  }}
                  disabled={!canPrev || loading}
                >
                  <ChevronLeft size={15} /> Previous
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    const next = offset + PAGE_SIZE;
                    setOffset(next);
                    setOtpRowId(null);
                    setOtpValue('');
                    void loadRows(next, status);
                  }}
                  disabled={!canNext || loading}
                >
                  Next <ChevronRight size={15} />
                </button>
              </span>
            </div>
          </>
        )}
      </div>

      <div className="super-help-list-block admin-section-block">
        <div className="section-head">
          <div>
            <p className="kicker">GOOD TO KNOW</p>
            <h2>How withdrawal approval works</h2>
          </div>
        </div>
        <ul className="super-help-list">
          <li>
            <b>Server-side only:</b> transfers are created, reversed and finalised by the
            <code> wallet-paystack-withdraw</code> Edge Function and service-role RPCs. This console
            cannot debit or credit a wallet.
          </li>
          <li>
            <b>OTP finalisation:</b> when Paystack answers <code>otp</code>, the transfer waits for
            the one-time password sent to the registered account owner. Only a super admin can supply
            it, and the Edge Function re-checks that role before calling Paystack.
          </li>
          <li>
            <b>Approval URLs:</b> shown only when Paystack genuinely returned one, and only when it
            is a valid <code>https://</code> address. Nothing is ever made up.
          </li>
          <li>
            <b>Refunds:</b> a failed transfer is reversed automatically by the server and the student
            is notified; there is no manual refund button here by design.
          </li>
        </ul>
      </div>
    </div>
  );
}
