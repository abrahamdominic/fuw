// PasskeysManager — register, list, rename and remove WebAuthn passkeys.
// Reused by both the Student and Admin settings panels.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import {
  registerPasskey,
  renamePasskey,
  listPasskeys,
  deletePasskey,
  isPasskeySupported,
  type PasskeyRegistration
} from '../lib/security';

type Status = { tone: 'success' | 'error'; message: string } | null;

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const msg = raw.toLowerCase();
  if (msg.includes('not supported') || msg.includes('notenabled') || msg.includes('not enabled')) {
    return 'This browser or connection does not support passkeys. Use HTTPS (or localhost) in a browser that supports WebAuthn.';
  }
  if (msg.includes('experimental')) {
    return 'Passkeys are not enabled on this server yet. Contact the library administrator to turn on the Passkeys experimental feature in Supabase.';
  }
  if (msg.includes('cancel') || msg.includes('abort')) {
    return 'Passkey setup was cancelled. You can try again whenever you are ready.';
  }
  if (!raw) return 'Something went wrong. Please try again.';
  return raw;
}

function formatDate(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

export const PasskeysManager: React.FC = () => {
  const [passkeys, setPasskeys] = useState<PasskeyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [supported, setSupported] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const supportedNow = useMemo(
    () => (typeof window === 'undefined' ? false : isPasskeySupported()),
    []
  );

  const load = useCallback(async (isRetry = false) => {
    setLoading(true);
    if (isRetry) setStatus(null);
    try {
      const list = await listPasskeys();
      setPasskeys(list);
      setSupported(true);
    } catch (e) {
      setStatus({ tone: 'error', message: describeError(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSupported(supportedNow);
    void load();
  }, [load, supportedNow]);

  const handleRegister = async () => {
    setBusyId('register');
    setStatus(null);
    try {
      const created = await registerPasskey();
      // Give the auth service a moment to persist credential metadata before
      // re-reading the list, then refresh once.
      await new Promise((r) => setTimeout(r, 600));
      await load();
      setStatus({ tone: 'success', message: 'Passkey registered. You can now sign in without your password.' });
    } catch (e) {
      setStatus({ tone: 'error', message: describeError(e) });
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (id: string) => {
    setBusyId(id);
    setStatus(null);
    try {
      await deletePasskey(id);
      setPasskeys((prev) => prev.filter((pk) => pk.id !== id));
      setStatus({ tone: 'success', message: 'Passkey removed from this account.' });
    } catch (e) {
      setStatus({ tone: 'error', message: describeError(e) });
    } finally {
      setBusyId(null);
    }
  };

  const beginRename = (pk: PasskeyRegistration) => {
    setRenamingId(pk.id);
    setRenameValue(pk.friendly_name ?? '');
    setStatus(null);
  };

  const commitRename = async (id: string) => {
    const next = renameValue.trim();
    setBusyId(id);
    setStatus(null);
    try {
      await renamePasskey({ passkeyId: id, friendlyName: next || 'Passkey' });
      setPasskeys((prev) =>
        prev.map((pk) => (pk.id === id ? { ...pk, friendly_name: next || 'Passkey' } : pk))
      );
      setRenamingId(null);
      setStatus({ tone: 'success', message: 'Passkey renamed.' });
    } catch (e) {
      setStatus({ tone: 'error', message: describeError(e) });
    } finally {
      setBusyId(null);
    }
  };

  const registerBusy = busyId === 'register';
  const canRegister = supportedNow && !busyId;

  return (
    <section className="security-tool-block" aria-labelledby="passkeys-heading">
      <div className="security-tool-head">
        <span className="security-tool-icon" aria-hidden="true">
          <Fingerprint size={22} strokeWidth={1.9} />
        </span>
        <div className="security-tool-info">
          <b id="passkeys-heading">Passkeys (passwordless sign-in)</b>
          <p>
            Register this device to sign in with your fingerprint, face, or a security key —
            no password required.
          </p>
        </div>
        <div className="security-tool-actions">
          {supportedNow ? (
            <span className="security-tool-status is-on">
              <span className="status-dot" aria-hidden="true" /> Supported
            </span>
          ) : (
            <span className="security-tool-status is-off">
              <AlertTriangle size={12} aria-hidden="true" /> Unavailable
            </span>
          )}
          <button
            type="button"
            className="primary save-btn security-tool-btn"
            onClick={handleRegister}
            disabled={!canRegister}
            aria-busy={registerBusy}
          >
            {registerBusy ? (
              <>
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                <span>Waiting for device…</span>
              </>
            ) : (
              <>
                <KeyRound size={15} aria-hidden="true" />
                <span>Register a passkey</span>
              </>
            )}
          </button>
        </div>
      </div>

      {!supportedNow && (
        <p className="security-tool-error" role="note">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            Passkeys need a secure connection (HTTPS or localhost) in a browser that supports
            WebAuthn. You can still sign in with your username and password.
          </span>
        </p>
      )}

      {registerBusy && (
        <p className="security-tool-note" role="status">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          <span>Follow your device prompt to finish setting up the passkey…</span>
        </p>
      )}

      {status && (
        <p
          className={status.tone === 'error' ? 'security-tool-error' : 'security-tool-success'}
          role={status.tone === 'error' ? 'alert' : 'status'}
        >
          {status.tone === 'error' ? (
            <AlertTriangle size={14} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={14} aria-hidden="true" />
          )}
          <span>{status.message}</span>
          {status.tone === 'error' && !loading && (
            <button type="button" className="link-btn security-tool-retry" onClick={() => void load(true)}>
              <RefreshCw size={13} aria-hidden="true" /> Retry
            </button>
          )}
        </p>
      )}

      {loading ? (
        <div className="security-tool-list" aria-hidden="true">
          {[0, 1].map((i) => (
            <div className="security-tool-row is-skeleton" key={i}>
              <span className="security-tool-row-icon" />
              <span className="security-tool-skeleton-text">
                <i style={{ width: '46%' }} />
                <i style={{ width: '68%' }} />
              </span>
            </div>
          ))}
        </div>
      ) : passkeys.length === 0 ? (
        <div className="security-tool-empty">
          <ShieldCheck size={22} aria-hidden="true" />
          <b>No passkeys yet</b>
          <span>Register one to sign in with your fingerprint, face, or security key.</span>
        </div>
      ) : (
        <ul className="security-tool-list">
          {passkeys.map((pk) => {
            const added = formatDate(pk.created_at);
            const used = formatDate(pk.last_used_at);
            const isRenaming = renamingId === pk.id;
            const rowBusy = busyId === pk.id;
            return (
              <li className="security-tool-row" key={pk.id}>
                <span className="security-tool-row-icon" aria-hidden="true">
                  <Fingerprint size={17} strokeWidth={1.9} />
                </span>

                <div className="security-tool-row-info">
                  {isRenaming ? (
                    <div className="security-tool-rename">
                      <label className="sr-only" htmlFor={`passkey-name-${pk.id}`}>
                        Passkey name
                      </label>
                      <input
                        id={`passkey-name-${pk.id}`}
                        className="security-tool-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(pk.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        maxLength={60}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="primary save-btn security-tool-rename-save"
                        onClick={() => void commitRename(pk.id)}
                        disabled={rowBusy}
                      >
                        {rowBusy ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="link-btn" onClick={() => setRenamingId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <b className="security-tool-row-name">{pk.friendly_name || 'Passkey'}</b>
                      <span className="security-tool-row-meta">
                        {added ? `Added ${added}` : 'Added recently'}
                        {used ? ` · Last used ${used}` : ' · Never used'}
                      </span>
                    </>
                  )}
                </div>

                {!isRenaming && (
                  <div className="security-tool-row-actions">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => beginRename(pk)}
                      disabled={!!busyId}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="link-btn danger security-tool-remove"
                      onClick={() => void handleRemove(pk.id)}
                      disabled={!!busyId}
                      aria-busy={rowBusy}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      <span>{rowBusy ? 'Removing…' : 'Remove'}</span>
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default PasskeysManager;