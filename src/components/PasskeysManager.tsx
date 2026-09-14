// PasskeysManager — register, list, and remove WebAuthn passkeys.
// Reused by both the Student and Admin settings panels.
import React, { useEffect, useState } from 'react';
import {
  registerPasskey,
  listPasskeys,
  deletePasskey,
  type PasskeyRegistration
} from '../lib/security';

export const PasskeysManager: React.FC = () => {
  const [passkeys, setPasskeys] = useState<PasskeyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPasskeys();
      setPasskeys(list);
    } catch (e: any) {
      setError(
        e?.message?.includes('enabled') || e?.message?.includes('experimental')
          ? 'Passkeys are not enabled on this server yet. Contact the library administrator to turn on the Passkeys experimental feature in Supabase.'
          : 'Could not load your passkeys.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleRegister = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await registerPasskey();
      async function waitForList() {
        // Small delay so the server-side metadata is visible in list().
        await new Promise((r) => setTimeout(r, 700));
      }
      await waitForList();
      await load();
      setNotice('Passkey registered successfully.');
      setTimeout(() => setNotice(null), 3500);
    } catch (e: any) {
      setError(e?.message || 'Passkey registration was cancelled or failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await deletePasskey(id);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not remove the passkey.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="security-tool-block">
      <div className="security-tool-head">
        <div className="security-tool-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2Z" />
            <path d="M8 16v3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3" />
            <path d="M12 8v4m-2-2h4" />
          </svg>
        </div>
        <div className="security-tool-info">
          <b>Passkeys (Passwordless sign-in)</b>
          <p>Use your device's fingerprint, face, or security key to sign in quickly and securely.</p>
        </div>
        <button
          type="button"
          className="primary save-btn security-tool-btn"
          onClick={handleRegister}
          disabled={busy}
        >
          {busy ? 'Registering…' : 'Register a Passkey'}
        </button>
      </div>

      {loading && <p className="security-tool-note">Loading passkeys…</p>}
      {!loading && error && <p className="security-tool-error">{error}</p>}
      {!loading && notice && <p className="security-tool-success">{notice}</p>}

      {!loading && !error && (
        <div className="security-tool-list">
          {passkeys.length === 0 ? (
            <p className="security-tool-note">
              No passkeys yet. Register one to sign in with your fingerprint, face, or security key.
            </p>
          ) : (
            passkeys.map((pk) => (
              <div key={pk.id} className="security-tool-row">
                <div className="security-tool-row-icon">
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2Z" />
                    <path d="M8 16v3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3" />
                  </svg>
                </div>
                <div className="security-tool-row-info">
                  <b>{pk.friendly_name || 'Security Key'}</b>
                  <span>
                    Added {pk.created_at ? new Date(pk.created_at).toLocaleDateString() : 'recently'}
                    {pk.last_used_at ? ` · Last used ${new Date(pk.last_used_at).toLocaleDateString()}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="link-btn danger security-tool-remove"
                  onClick={() => handleRemove(pk.id)}
                  disabled={busy}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default PasskeysManager;