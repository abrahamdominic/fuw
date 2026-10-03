import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Crown, Loader2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { requireSupabase } from '../lib/supabase';

interface PremiumFeature {
  feature_key: string;
  label: string;
  description: string;
  is_enabled: boolean;
  updated_at: string;
}

interface PremiumAuditEntry {
  id: string;
  admin_name: string | null;
  action: string;
  previous_state: Record<string, unknown>;
  new_state: Record<string, unknown>;
  identifiers: Record<string, unknown>;
  created_at: string;
}

interface PremiumConfiguration {
  enabled: boolean;
  global_grant_enabled: boolean;
  features: PremiumFeature[];
  audit_logs: PremiumAuditEntry[];
}

type ConfirmAction =
  | { kind: 'system'; enabled: boolean }
  | { kind: 'global'; enabled: boolean };

const EMPTY: PremiumConfiguration = {
  enabled: true,
  global_grant_enabled: false,
  features: [],
  audit_logs: []
};

export function SuperAdminPremiumTab() {
  const { toast } = useToast();
  const [configuration, setConfiguration] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyFeature, setBusyFeature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: loadError } = await requireSupabase().rpc('get_premium_admin_configuration');
      if (loadError) throw new Error(loadError.message);
      setConfiguration({ ...EMPTY, ...(data as Partial<PremiumConfiguration>) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load Premium settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmChange = async () => {
    if (!confirmAction) return;
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await requireSupabase().rpc(
        confirmAction.kind === 'system' ? 'set_premium_system_enabled' : 'set_global_premium_grant',
        { p_enabled: confirmAction.enabled }
      );
      if (updateError) throw new Error(updateError.message);
      toast(
        confirmAction.kind === 'system'
          ? `Premium system ${confirmAction.enabled ? 'enabled' : 'disabled'}.`
          : `Global Premium grant ${confirmAction.enabled ? 'enabled' : 'disabled'}.`,
        'success'
      );
      setConfirmAction(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save Premium settings.');
    } finally {
      setBusy(false);
    }
  };

  const toggleFeature = async (feature: PremiumFeature) => {
    setBusyFeature(feature.feature_key);
    setError(null);
    try {
      const { error: updateError } = await requireSupabase().rpc('set_premium_feature_enabled', {
        p_feature_key: feature.feature_key,
        p_enabled: !feature.is_enabled
      });
      if (updateError) throw new Error(updateError.message);
      toast(`${feature.label} ${feature.is_enabled ? 'disabled' : 'enabled'}.`, 'success');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not update ${feature.label}.`);
    } finally {
      setBusyFeature(null);
    }
  };

  return (
    <div className="portal-view-fade premium-admin-page">
      <div className="page-head">
        <div className="page-head-text">
          <p className="kicker">PLATFORM GOVERNANCE</p>
          <h1>Premium Management</h1>
          <p>This page controls Premium access, global grants, payment access, and Premium feature availability.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {error && <p className="inline-notice is-error" role="alert">{error}</p>}

      {loading ? (
        <p className="muted-row" role="status"><Loader2 size={15} className="animate-spin" /> Loading Premium controls…</p>
      ) : (
        <>
          <section className="premium-admin-controls" aria-label="Premium system controls">
            <article className={`premium-admin-control ${configuration.enabled ? 'is-enabled' : ''}`}>
              <div className="premium-admin-control-icon"><Crown size={20} aria-hidden="true" /></div>
              <div className="premium-admin-control-copy">
                <h2>Premium System</h2>
                <p>{configuration.enabled
                  ? 'Premium features and purchase options follow their individual settings.'
                  : 'Premium purchase options and Premium-only features are disabled. Existing entitlements remain stored.'}</p>
                <span className={`premium-admin-status ${configuration.enabled ? 'is-on' : 'is-off'}`}>
                  {configuration.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
              <button
                type="button"
                className={configuration.enabled ? 'danger-btn-outline' : 'primary'}
                onClick={() => setConfirmAction({ kind: 'system', enabled: !configuration.enabled })}
                disabled={busy}
              >
                {configuration.enabled ? 'Disable Premium' : 'Enable Premium'}
              </button>
            </article>

            <article className={`premium-admin-control ${configuration.global_grant_enabled ? 'is-enabled' : ''}`}>
              <div className="premium-admin-control-icon is-gold"><Sparkles size={20} aria-hidden="true" /></div>
              <div className="premium-admin-control-copy">
                <h2>Grant Premium Access to All Members</h2>
                <p>{configuration.global_grant_enabled
                  ? 'Active student members have a GLOBAL_PREMIUM entitlement. New student accounts receive one while enabled.'
                  : 'Grant an auditable GLOBAL_PREMIUM entitlement to eligible active members, without creating payments.'}</p>
                <span className={`premium-admin-status ${configuration.global_grant_enabled ? 'is-on' : 'is-off'}`}>
                  {configuration.global_grant_enabled ? 'ON' : 'OFF'}
                </span>
              </div>
              <button
                type="button"
                className={configuration.global_grant_enabled ? 'danger-btn-outline' : 'primary'}
                onClick={() => setConfirmAction({ kind: 'global', enabled: !configuration.global_grant_enabled })}
                disabled={busy}
              >
                {configuration.global_grant_enabled ? 'Remove global grant' : 'Grant to all members'}
              </button>
            </article>
          </section>

          <section className="admin-section-block">
            <div className="section-head">
              <div><p className="kicker">FEATURE AVAILABILITY</p><h2>Premium features</h2></div>
            </div>
            <div className="premium-feature-list">
              {configuration.features.map((feature) => (
                <label className="premium-feature-row" key={feature.feature_key}>
                  <span className="premium-feature-icon"><BadgeCheck size={17} aria-hidden="true" /></span>
                  <span className="premium-feature-copy"><b>{feature.label}</b><small>{feature.description}</small></span>
                  <span className="premium-feature-state">{feature.is_enabled ? 'Enabled' : 'Disabled'}</span>
                  <input
                    type="checkbox"
                    checked={feature.is_enabled}
                    disabled={busyFeature !== null}
                    onChange={() => void toggleFeature(feature)}
                    aria-label={`${feature.is_enabled ? 'Disable' : 'Enable'} ${feature.label}`}
                  />
                  {busyFeature === feature.feature_key && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                </label>
              ))}
              {configuration.features.length === 0 && <p className="muted-row">No Premium features are configured.</p>}
            </div>
          </section>

          <section className="admin-section-block premium-audit-section">
            <div className="section-head">
              <div><p className="kicker">CHANGE HISTORY</p><h2>Premium audit log</h2></div>
              <ShieldCheck size={19} aria-hidden="true" />
            </div>
            {configuration.audit_logs.length ? (
              <ol className="premium-audit-list">
                {configuration.audit_logs.map((entry) => (
                  <li key={entry.id}>
                    <b>{entry.action.replaceAll('_', ' ')}</b>
                    <span>{entry.admin_name || 'Former administrator'} · {new Date(entry.created_at).toLocaleString()}</span>
                    <small>
                      {entry.identifiers.feature_key ? `Feature: ${String(entry.identifiers.feature_key)} · ` : ''}
                      {JSON.stringify(entry.previous_state)} → {JSON.stringify(entry.new_state)}
                    </small>
                  </li>
                ))}
              </ol>
            ) : <p className="muted-row">No Premium settings changes have been recorded.</p>}
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.kind === 'global'
          ? confirmAction.enabled ? 'Grant Premium to all members?' : 'Remove the global Premium grant?'
          : confirmAction?.enabled ? 'Enable the Premium system?' : 'Disable the Premium system?'}
        message={confirmAction?.kind === 'global'
          ? confirmAction.enabled
            ? 'All eligible active student members will receive Premium access without payment transactions. New student accounts also receive the global grant while it remains enabled.'
            : 'Only GLOBAL_PREMIUM entitlements will be removed. Paid Premium and valid individual admin grants will remain active.'
          : confirmAction?.enabled
            ? 'Premium functionality and purchases will become available according to the configured feature and payment settings.'
            : 'Premium purchase options will be hidden and new purchases rejected. Entitlements and configuration stay stored; Premium access is disabled until you turn the system back on.'}
        confirmLabel={busy ? 'Saving…' : 'Confirm'}
        onConfirm={confirmChange}
        onClose={() => { if (!busy) setConfirmAction(null); }}
      />
    </div>
  );
}

export default SuperAdminPremiumTab;
