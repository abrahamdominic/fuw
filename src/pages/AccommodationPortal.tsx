import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Check,
  ChevronRight,
  Eye,
  Home,
  LayoutDashboard,
  List,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Square,
  Trash2,
  UserCheck,
  Users,
  Wallet,
  X
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../components/Toast';
import { requireSupabase } from '../lib/supabase';
import { formatNaira } from '../lib/accommodation';
import { previewAdvertFee, advertFeeKobo, annualRentKobo, type RentPeriod } from '../lib/advertFee';
import {
  assignCaretaker,
  fetchMyAdvertPayments,
  fetchMyAssignments,
  fetchMyProperties,
  fetchMyProvider,
  revokeCaretaker,
  registerProvider,
  saveProperty,
  setPropertyState,
  submitAdvert,
  uploadListingImage,
  type AdvertPayment,
  type CaretakerAssignment,
  type ProviderProfile,
  type ProviderProperty
} from '../lib/accommodationPortal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SEO } from '../components/SEO';
import { fx } from '../lib/motion';

type Tab = 'overview' | 'listings' | 'wallet' | 'assignments' | 'settings';

const TABS: Array<{ key: Tab; label: string; icon: React.ComponentType<{ size?: number | string }> }> = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'listings', label: 'Listings', icon: List },
  { key: 'wallet', label: 'Wallet', icon: Wallet },
  { key: 'assignments', label: 'Assignments', icon: Users },
  { key: 'settings', label: 'Settings', icon: UserCheck }
];

function moderationBadge(status: string) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    draft: { bg: 'var(--surface-alt)', fg: 'var(--text-secondary)', label: 'Draft' },
    pending_review: { bg: 'var(--warning-bg)', fg: 'var(--amber-700)', label: 'Pending review' },
    approved: { bg: 'var(--success-bg)', fg: '#047857', label: 'Live' },
    rejected: { bg: 'var(--error-bg)', fg: 'var(--red-700)', label: 'Rejected' },
    rented: { bg: 'var(--error-bg)', fg: 'var(--red-700)', label: 'Rented' },
    removed: { bg: 'var(--surface-alt)', fg: 'var(--text-secondary)', label: 'Removed' },
    submitted: { bg: 'var(--surface-alt)', fg: 'var(--text-secondary)', label: 'Submitted' }
  };
  return map[status] ?? { bg: 'var(--surface-alt)', fg: 'var(--text-secondary)', label: status };
}

export function AccommodationPortal() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    return (TABS.some((t) => t.key === q) ? q : 'overview') as Tab;
  });

  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [properties, setProperties] = useState<ProviderProperty[]>([]);
  const [payments, setPayments] = useState<AdvertPayment[]>([]);
  const [assignments, setAssignments] = useState<CaretakerAssignment[]>([]);
  const [wallet, setWallet] = useState<Record<string, number> | null>(null);

  const [listingEditor, setListingEditor] = useState<ProviderProperty | 'new' | null>(null);
  const [submitTarget, setSubmitTarget] = useState<ProviderProperty | null>(null);
  const [stateTarget, setStateTarget] = useState<{ property: ProviderProperty; action: 'rented' | 'removed' } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const reload = useCallback(async () => {
    try {
      const client = requireSupabase();
      const [prov, props, pays, assigns, walletData] = await Promise.all([
        fetchMyProvider(),
        fetchMyProperties(),
        fetchMyAdvertPayments(),
        fetchMyAssignments(),
        client.rpc('mp_wallet_get').then((r) => (r.error ? null : r.data))
      ]);
      setProvider(prov);
      setProperties(props);
      setPayments(pays);
      setAssignments(assigns);
      setWallet(walletData as Record<string, number> | null);
    } catch (err: any) {
      toast(err?.message || 'Failed to load your portal.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}`);
  }, [tab]);

  const liveCount = useMemo(() => properties.filter((p) => p.is_published && p.moderation_status === 'approved').length, [properties]);
  const pendingCount = useMemo(() => properties.filter((p) => p.moderation_status === 'pending_review').length, [properties]);
  const draftCount = useMemo(() => properties.filter((p) => p.moderation_status === 'draft').length, [properties]);
  const capturedTotal = useMemo(() => payments.filter((p) => p.payment_status === 'captured').reduce((s, p) => s + p.fee_kobo, 0), [payments]);

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <div className={fx.fadeIn} style={{ maxWidth: 1120, margin: '0 auto', padding: '0 16px 48px' }}>
      <SEO
        title="Landlord & Caretaker Portal | FUW Campus Hub"
        description="Private landlord and caretaker accommodation management dashboard."
        path="/provider"
        noindex
      />
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          padding: '20px 0 16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: 'var(--green-100, #dcfce7)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--green-800, #166534)'
            }}
          >
            <Home size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              {(profile?.role === 'landlord' ? 'Landlord' : profile?.role === 'caretaker' ? 'Caretaker' : 'Accommodation')} Portal
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>{user?.email}</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Link to="/accommodation" className="btn btn-secondary" style={{ gap: 6 }}>
            <ArrowUpRight size={15} /> Public listings
          </Link>
          <button type="button" className="btn btn-secondary" onClick={reload} title="Refresh" style={{ padding: '8px 10px' }}>
            <RefreshCw size={15} />
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmLogout(true)} style={{ gap: 6, color: 'var(--red-700)' }}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>

      {/* Status banner */}
      {provider && provider.registered && (
        <StatusBanner provider={provider} />
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20, overflowX: 'auto' }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 16px',
                border: 'none',
                background: 'none',
                fontWeight: tab === t.key ? 800 : 500,
                color: tab === t.key ? 'var(--primary)' : 'var(--text-secondary)',
                borderBottom: tab === t.key ? '3px solid var(--primary)' : '3px solid transparent',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                whiteSpace: 'nowrap'
              }}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <span className="route-fallback-spinner" />
          <p style={{ color: 'var(--text-secondary)' }}>Loading your portal…</p>
        </div>
      ) : !provider?.registered ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <Building2 size={40} color="var(--muted)" style={{ marginBottom: 12 }} />
          <h2 style={{ margin: '0 0 8px' }}>You are not registered yet</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            Complete your landlord or caretaker application to start listing accommodation.
          </p>
          <Link to="/register/provider" className="btn btn-primary" style={{ gap: 8 }}>
            Register as a provider
          </Link>
        </div>
      ) : (
        <>
          {tab === 'overview' && (
            <Overview
              provider={provider}
              properties={properties}
              liveCount={liveCount}
              pendingCount={pendingCount}
              draftCount={draftCount}
              capturedTotal={capturedTotal}
              wallet={wallet}
              onGoToListings={() => setTab('listings')}
            />
          )}

          {tab === 'listings' && (
            <ListingsTab
              properties={properties}
              wallets={{
                role: provider.role,
                providerId: provider.id ?? null,
                isLandlord: profile?.role === 'landlord'
              }}
              onEdit={(p) => setListingEditor(p)}
              onCreate={() => setListingEditor('new')}
              onSubmit={(p) => setSubmitTarget(p)}
              onState={(p, action) => setStateTarget({ property: p, action })}
              onChanged={reload}
            />
          )}

          {tab === 'wallet' && (
            <WalletTab wallet={wallet} payments={payments} />
          )}

          {tab === 'assignments' && (
            <AssignmentsTab
              provider={provider}
              isLandlord={profile?.role === 'landlord'}
              assignments={assignments}
              onAssign={() => setAssignOpen(true)}
              onRevoke={async (id) => {
                try {
                  await revokeCaretaker(id);
                  toast('Assignment revoked.', 'success');
                  await reload();
                } catch (err: any) {
                  toast(err?.message || 'Failed to revoke assignment', 'error');
                }
              }}
              onChanged={reload}
            />
          )}

          {tab === 'settings' && (
            <SettingsTab
              provider={provider}
              isLandlord={profile?.role === 'landlord'}
              onSaved={async () => {
                await refreshProfile().catch(() => null);
                await reload();
              }}
            />
          )}
        </>
      )}

      {/* Listing editor modal */}
      {listingEditor && (
        <ListingEditor
          property={listingEditor === 'new' ? null : listingEditor}
          onClose={() => setListingEditor(null)}
          onSaved={async () => {
            setListingEditor(null);
            await reload();
          }}
        />
      )}

      {/* Submit for review confirm */}
      {submitTarget && (
        <SubmitModal
          property={submitTarget}
          onClose={() => setSubmitTarget(null)}
          onDone={async () => {
            setSubmitTarget(null);
            await reload();
          }}
        />
      )}

      {/* Mark rented / removed confirm */}
      {stateTarget && (
        <ConfirmDialog
          open
          title={stateTarget.action === 'rented' ? 'Mark as rented?' : 'Remove listing?'}
          message={
            stateTarget.action === 'rented'
              ? `Mark "${stateTarget.property.title}" as rented? It will be taken down from the public directory. This never refunds the advertisement fee.`
              : `Remove "${stateTarget.property.title}"? It will be hidden from the public directory. This never refunds the advertisement fee.`
          }
          confirmLabel={stateTarget.action === 'rented' ? 'Mark rented' : 'Remove listing'}
          tone="danger"
          onConfirm={async () => {
            try {
              await setPropertyState(stateTarget.property.id, stateTarget.action);
              toast(stateTarget.action === 'rented' ? 'Marked as rented.' : 'Listing removed.', 'success');
              setStateTarget(null);
              await reload();
            } catch (err: any) {
              toast(err?.message || 'Action failed.', 'error');
            }
          }}
          onClose={() => setStateTarget(null)}
        />
      )}

      {assignOpen && (
        <AssignModal
          properties={properties.filter((p) => p.is_owner && p.moderation_status !== 'draft')}
          onClose={() => setAssignOpen(false)}
          onDone={async () => {
            setAssignOpen(false);
            await reload();
          }}
        />
      )}

      {confirmLogout && (
        <ConfirmDialog
          open
          title="Sign out"
          message="Sign out of your provider portal?"
          confirmLabel="Sign out"
          onConfirm={handleLogout}
          onClose={() => setConfirmLogout(false)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function StatusBanner({ provider }: { provider: ProviderProfile }) {
  const status = provider.verification_status;
  if (status === 'verified') {
    return (
      <div className="card" style={{ padding: '12px 16px', marginBottom: 20, background: 'var(--success-bg, #ecfdf5)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <BadgeCheck size={18} style={{ color: '#047857' }} />
        <span style={{ fontSize: 13, color: '#047857', fontWeight: 700 }}>Account verified — your listings can go live after review.</span>
      </div>
    );
  }
  if (status === 'rejected') {
    return (
      <div className="card" style={{ padding: '12px 16px', marginBottom: 20, background: 'var(--error-bg)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <ShieldAlert size={18} style={{ color: 'var(--red-700)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 13, color: 'var(--red-700)' }}>
          <strong>Application rejected.</strong> Please correct the issues in Settings and resubmit.
          {provider.rejection_reason && <p style={{ margin: '4px 0 0', fontSize: 12 }}>Reason: {provider.rejection_reason}</p>}
        </div>
      </div>
    );
  }
  if (status === 'suspended') {
    return (
      <div className="card" style={{ padding: '12px 16px', marginBottom: 20, background: 'var(--error-bg)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <ShieldAlert size={18} style={{ color: 'var(--red-700)' }} />
        <span style={{ fontSize: 13, color: 'var(--red-700)', fontWeight: 700 }}>Account suspended. Contact support to resolve this.</span>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: '12px 16px', marginBottom: 20, background: 'var(--warning-bg)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <Loader2 size={18} className="animate-spin" style={{ color: 'var(--amber-700)' }} />
      <span style={{ fontSize: 13, color: 'var(--amber-700)', fontWeight: 700 }}>
        Application under review — you can prepare listings, but they cannot go live until you are verified.
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Overview({
  provider,
  properties,
  liveCount,
  pendingCount,
  draftCount,
  capturedTotal,
  wallet,
  onGoToListings
}: {
  provider: ProviderProfile;
  properties: ProviderProperty[];
  liveCount: number;
  pendingCount: number;
  draftCount: number;
  capturedTotal: number;
  wallet: Record<string, number> | null;
  onGoToListings: () => void;
}) {
  const stats = [
    { label: 'Total listings', value: properties.length },
    { label: 'Live', value: liveCount },
    { label: 'In review', value: pendingCount },
    { label: 'Drafts', value: draftCount },
    { label: 'Advert fees captured', value: formatNaira(capturedTotal / 100) }
  ];
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        {stats.map((s) => (
          <div key={s.label} className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 800 }}>Wallet</h3>
          {wallet ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Available</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{formatNaira((wallet.available_kobo ?? 0) / 100)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Reserved (pending)</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{formatNaira((wallet.pending_kobo ?? 0) / 100)}</div>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <Link to="/marketplace/wallet" className="btn btn-secondary" style={{ gap: 6, marginTop: 6 }}>
                  <Wallet size={15} /> Fund wallet
                </Link>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>Wallet not available right now.</p>
          )}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800 }}>Provider details</h3>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>{provider.full_name}</strong>
            {provider.business_name ? ` · ${provider.business_name}` : ''}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            {provider.town || '—'} {provider.state ? `, ${provider.state}` : ''}
          </p>
          {provider.rejection_reason ? (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--red-700)' }}>{provider.rejection_reason}</p>
          ) : null}
        </div>
      </div>

      <button type="button" className="btn btn-primary" onClick={onGoToListings} style={{ gap: 8, marginTop: 16 }}>
        <Plus size={16} /> Manage listings
      </button>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ListingsTab({
  properties,
  wallets,
  onEdit,
  onCreate,
  onSubmit,
  onState,
  onChanged
}: {
  properties: ProviderProperty[];
  wallets: { role: string | null; providerId: string | null; isLandlord: boolean };
  onEdit: (p: ProviderProperty) => void;
  onCreate: () => void;
  onSubmit: (p: ProviderProperty) => void;
  onState: (p: ProviderProperty, action: 'rented' | 'removed') => void;
  onChanged: () => void;
}) {
  const canCreate = wallets.role === 'landlord';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
          {canCreate
            ? 'Create a draft listing, then submit it for review. A 1.5% advertisement fee (of the annual rent) is reserved from your wallet while it is reviewed.'
            : 'You manage listings that the landlord assigned to you. Only the parts you were granted permission for are shown.'}
        </p>
        {canCreate && (
          <button type="button" className="btn btn-primary" onClick={onCreate} style={{ gap: 8 }}>
            <Plus size={16} /> New listing
          </button>
        )}
      </div>

      {properties.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <Home size={40} color="var(--muted)" style={{ marginBottom: 12 }} />
          <h3 style={{ margin: '0 0 6px' }}>No listings yet</h3>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            {canCreate ? 'Click "New listing" to create your first draft.' : 'No properties have been assigned to you.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-alt)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px' }}>Listing</th>
                <th style={{ padding: '12px 16px' }}>Rent / period</th>
                <th style={{ padding: '12px 16px' }}>Status</th>
                <th style={{ padding: '12px 16px' }}>Advert fee</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => {
                const badge = moderationBadge(p.moderation_status);
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                        {p.location_area} {p.is_owner ? '' : '· assigned'}
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px', fontWeight: 700, color: 'var(--green-800)' }}>
                      {annualRentKobo(p.advert_rent_kobo, p.rent_period) ? formatNaira((p.advert_rent_kobo ?? 0) / 100) : formatNaira(p.price_annual)}
                      <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: 12 }}> / {p.rent_period}</span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span className="badge" style={{ background: badge.bg, color: badge.fg, fontWeight: 700 }}>
                        {badge.label}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {p.payment_status ? (
                        <div>
                          <div style={{ fontWeight: 700 }}>{formatNaira((p.fee_kobo ?? 0) / 100)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.payment_status}</div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Not paid yet</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {p.is_published && p.moderation_status === 'approved' && (
                          <a href={`/accommodation/${p.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: 6 }} title="View public page">
                            <Eye size={14} />
                          </a>
                        )}
                        {(p.moderation_status === 'draft' || p.moderation_status === 'rejected') && p.is_owner && (
                          <button type="button" className="btn btn-secondary" style={{ padding: 6 }} title="Edit draft" onClick={() => onEdit(p)}>
                            <Pencil size={14} />
                          </button>
                        )}
                        {(p.moderation_status === 'draft' || p.moderation_status === 'rejected') && (
                          <button type="button" className="btn btn-primary" style={{ padding: '6px 10px' }} title="Submit for review" onClick={() => onSubmit(p)}>
                            Submit
                          </button>
                        )}
                        {(p.moderation_status === 'approved' || p.moderation_status === 'pending_review') && (
                          <>
                            {p.moderation_status === 'approved' && (
                              <>
                                <button type="button" className="btn btn-secondary" style={{ padding: 6, color: 'var(--red-700)' }} title="Mark as rented" onClick={() => onState(p, 'rented')}>
                                  <Square size={14} />
                                </button>
                                <button type="button" className="btn btn-secondary" style={{ padding: 6 }} title="Remove listing" onClick={() => onState(p, 'removed')}>
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export const LOCATION_AREAS = ['New Site', 'Old Site', 'Hospital Road', 'Stadium Road', 'General Hospital Area', 'Katsina-Ala Road', 'Campus Environs', 'Wukari Town'] as const;
export const PROPERTY_TYPE_OPTIONS = [
  { value: 'self_contained', label: 'Self-Contained' },
  { value: 'single_room', label: 'Single Room' },
  { value: 'flat_apartment', label: 'Flat / Apartment' },
  { value: 'bedspace', label: 'Bed Space' },
  { value: 'shared_room', label: 'Shared Room' }
] as const;
export const POPULAR_AMENITIES = [
  'Running Water',
  'Prepaid Meter / Light',
  'Fenced & Gated',
  'Security Guard',
  'Well Water / Borehole',
  'Tiled Floors',
  'Wardrobe',
  'Kitchenette / Kitchen',
  'Inverter / Solar Friendly',
  'Balcony'
] as const;

function ListingEditor({
  property,
  onClose,
  onSaved
}: {
  property: ProviderProperty | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(property?.title ?? '');
  const [description, setDescription] = useState(property?.description ?? '');
  const [locationArea, setLocationArea] = useState(property?.location_area ?? 'New Site');
  const [addressLandmark, setAddressLandmark] = useState(property?.address_landmark ?? '');
  const [propertyType, setPropertyType] = useState(property?.property_type ?? 'self_contained');
  const [rentAmountNaira, setRentAmountNaira] = useState(() =>
    property ? (property.advert_rent_kobo ?? property.price_annual * 100) / 100 : 0
  );
  const [rentPeriod, setRentPeriod] = useState<RentPeriod>(property?.rent_period ?? 'annual');
  const [totalUnits, setTotalUnits] = useState(property?.total_units ?? 1);
  const [availableUnits, setAvailableUnits] = useState(property?.available_units ?? 1);
  const [availabilityStatus, setAvailabilityStatus] = useState(property?.availability_status ?? 'available');
  const [contactPhone, setContactPhone] = useState(property?.contact_phone ?? '');
  const [contactWhatsapp, setContactWhatsapp] = useState(property?.contact_whatsapp ?? '');
  const [rulesNotes, setRulesNotes] = useState('');
  const [images, setImages] = useState<string[]>(property?.images ?? []);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [amenities, setAmenities] = useState<string[]>(property?.amenities ?? []);

  const amountKobo = Math.round((rentAmountNaira || 0) * 100);
  const preview = previewAdvertFee(amountKobo, rentPeriod, 150);

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadingImage(true);
    try {
      const url = await uploadListingImage(file);
      setImages((prev) => [...prev, url]);
      toast('Photo added.', 'success');
    } catch (err: any) {
      toast(err?.message || 'Upload failed.', 'error');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim() || !addressLandmark.trim() || !contactPhone.trim()) {
      toast('Fill in the title, description, address and contact phone.', 'error');
      return;
    }
    setBusy(true);
    try {
      await saveProperty({
        propertyId: property?.id ?? null,
        title,
        description,
        locationArea,
        addressLandmark,
        propertyType,
        rentAmountKobo: amountKobo,
        rentPeriod,
        totalUnits,
        availableUnits,
        availabilityStatus,
        images,
        amenities,
        contactPhone,
        contactWhatsapp: contactWhatsapp.trim() || undefined,
        distanceToCampus: undefined,
        cautionDepositKobo: 0,
        serviceChargeKobo: 0,
        rulesNotes: rulesNotes.trim() || undefined
      });
      toast(property ? 'Listing updated.' : 'Draft listing created.', 'success');
      await onSaved();
    } catch (err: any) {
      toast(err?.message || 'Could not save the listing.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-overlay" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 720, width: '100%', maxHeight: '92vh', overflowY: 'auto', padding: 28, borderRadius: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>
            {property ? `Edit listing` : 'New listing'}
          </h3>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ padding: 6 }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Listing title *">
            <input className="form-input" style={{ width: '100%' }} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description *">
            <textarea className="form-input" style={{ width: '100%' }} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Location area *">
              <select className="form-select" style={{ width: '100%' }} value={locationArea} onChange={(e) => setLocationArea(e.target.value)}>
                {LOCATION_AREAS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Room type *">
              <select className="form-select" style={{ width: '100%' }} value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                {PROPERTY_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Address / landmark *">
            <input className="form-input" style={{ width: '100%' }} value={addressLandmark} onChange={(e) => setAddressLandmark(e.target.value)} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Advertised rent (₦) *">
              <input className="form-input" style={{ width: '100%' }} type="number" min={0} value={rentAmountNaira} onChange={(e) => setRentAmountNaira(Number(e.target.value))} />
            </Field>
            <Field label="Rent period *">
              <select className="form-select" style={{ width: '100%' }} value={rentPeriod} onChange={(e) => setRentPeriod(e.target.value as RentPeriod)}>
                <option value="annual">Per year</option>
                <option value="semester">Per semester</option>
                <option value="monthly">Per month</option>
              </select>
            </Field>
          </div>

          {preview && (
            <div className="card" style={{ padding: '10px 14px', background: 'var(--success-bg, #ecfdf5)', fontSize: 13 }}>
              <strong>Advertisement fee: {formatNaira(preview.feeKobo / 100)}</strong> (1.5% of the annual rent
              {rentPeriod === 'annual'
                ? ''
                : ` — annualised to ${formatNaira(preview.annualKobo / 100)}`}
              ). Reserved from your wallet when you submit for review.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Total units">
              <input className="form-input" style={{ width: '100%' }} type="number" min={1} value={totalUnits} onChange={(e) => setTotalUnits(Number(e.target.value))} />
            </Field>
            <Field label="Available units">
              <input className="form-input" style={{ width: '100%' }} type="number" min={0} value={availableUnits} onChange={(e) => setAvailableUnits(Number(e.target.value))} />
            </Field>
          </div>

          <Field label="Availability">
            <select className="form-select" style={{ width: '100%' }} value={availabilityStatus} onChange={(e) => setAvailabilityStatus(e.target.value)}>
              <option value="available">Available</option>
              <option value="fast_filling">Fast filling</option>
              <option value="booked">Booked</option>
              <option value="under_maintenance">Under maintenance</option>
            </select>
          </Field>

          <Field label="Photos">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {images.map((img, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={img} alt={`Photo ${i + 1}`} style={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, background: 'var(--error-bg)', border: 'none', borderRadius: 999, width: 18, height: 18, cursor: 'pointer', color: 'var(--red-700)', display: 'grid', placeItems: 'center' }}
                    title="Remove photo"
                  >
                    ×
                  </button>
                </div>
              ))}
              <label className="btn btn-secondary" style={{ cursor: uploadingImage ? 'not-allowed' : 'pointer', gap: 6, padding: '8px 12px' }}>
                {uploadingImage ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
                {uploadingImage ? 'Uploading…' : 'Add photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" style={{ display: 'none' }} disabled={uploadingImage} onChange={(e) => { handleUpload(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>
          </Field>

          <Field label="Amenities">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6 }}>
              {POPULAR_AMENITIES.map((a) => {
                const checked = amenities.includes(a);
                return (
                  <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={() => setAmenities(checked ? amenities.filter((x) => x !== a) : [...amenities, a])} />
                    {a}
                  </label>
                );
              })}
            </div>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Contact phone *">
              <input className="form-input" style={{ width: '100%' }} type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </Field>
            <Field label="WhatsApp (optional)">
              <input className="form-input" style={{ width: '100%' }} value={contactWhatsapp} onChange={(e) => setContactWhatsapp(e.target.value)} />
            </Field>
          </div>

          <Field label="Rules / notes (optional)">
            <textarea className="form-input" style={{ width: '100%' }} rows={2} value={rulesNotes} onChange={(e) => setRulesNotes(e.target.value)} />
          </Field>

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={onClose} className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
            <button type="submit" disabled={busy} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
              {busy ? <><Loader2 className="animate-spin" size={16} /> Saving…</> : 'Save draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SubmitModal({ property, onClose, onDone }: { property: ProviderProperty; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const fee = advertFeeKobo(property.advert_rent_kobo ?? (property.price_annual * 100), 150);
  return (
    <ConfirmDialog
      open
      title="Submit for review?"
      message={
        fee > 0
          ? `A ${formatNaira(fee / 100)} advertisement fee (1.5% of the annual rent) will be reserved from your wallet. It is captured if the listing is approved, and returned if it is rejected.`
          : `"${property.title}" will be sent for review with no advertisement fee.`
      }
      confirmLabel="Reserve fee & submit"
      busy={busy}
      onConfirm={async () => {
        setBusy(true);
        try {
          await submitAdvert(property.id);
          toast('Submitted for review. An administrator will respond shortly.', 'success');
          await onDone();
        } catch (err: any) {
          if (err?.message?.startsWith('INSUFFICIENT_FUNDS')) {
            toast('Your wallet balance is too low. Fund it before submitting.', 'error');
          } else {
            toast(err?.message || 'Could not submit.', 'error');
          }
          setBusy(false);
        }
      }}
      onClose={onClose}
    />
  );
}

/* -------------------------------------------------------------------------- */

function WalletTab({ wallet, payments }: { wallet: Record<string, number> | null; payments: AdvertPayment[] }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Available balance</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{formatNaira((wallet?.available_kobo ?? 0) / 100)}</div>
        </div>
        <div className="card" style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Reserved (in review)</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{formatNaira((wallet?.pending_kobo ?? 0) / 100)}</div>
        </div>
        <div className="card" style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{formatNaira((wallet?.total_kobo ?? 0) / 100)}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Fees are held in your wallet in a reserved bucket while a listing is reviewed. Approval moves the fee into
          the platform; rejection returns it to your available balance automatically.
        </p>
        <Link to="/marketplace/wallet" className="btn btn-secondary" style={{ gap: 6, marginTop: 12 }}>
          <Wallet size={15} /> Open marketplace wallet
        </Link>
      </div>

      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        {payments.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
            <h3 style={{ margin: '0 0 6px' }}>No advertisement fees yet</h3>
            <p style={{ margin: 0, fontSize: 13 }}>Fees you reserve when submitting listings appear here.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-alt)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px' }}>Listing</th>
                <th style={{ padding: '12px 16px' }}>Annual rent</th>
                <th style={{ padding: '12px 16px' }}>Fee</th>
                <th style={{ padding: '12px 16px' }}>Status</th>
                <th style={{ padding: '12px 16px' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const badge = p.payment_status === 'captured'
                  ? { bg: 'var(--success-bg)', fg: '#047857', label: 'Captured' }
                  : p.payment_status === 'refunded'
                    ? { bg: 'var(--surface-alt)', fg: 'var(--text-secondary)', label: 'Refunded' }
                    : { bg: 'var(--warning-bg)', fg: 'var(--amber-700)', label: 'Reserved' };
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '14px 16px', fontWeight: 700 }}>{p.property_title || '—'}</td>
                    <td style={{ padding: '14px 16px' }}>{formatNaira(p.annual_rent_kobo / 100)}</td>
                    <td style={{ padding: '14px 16px', fontWeight: 700 }}>{formatNaira(p.fee_kobo / 100)}</td>
                    <td style={{ padding: '14px 16px' }}>
                      <span className="badge" style={{ background: badge.bg, color: badge.fg, fontWeight: 700 }}>{badge.label}</span>
                    </td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{new Date(p.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AssignmentsTab({
  provider,
  isLandlord,
  assignments,
  onAssign,
  onRevoke,
  onChanged
}: {
  provider: ProviderProfile;
  isLandlord: boolean;
  assignments: CaretakerAssignment[];
  onAssign: () => void;
  onRevoke: (id: string) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
          {isLandlord
            ? 'Assign caretakers to your properties. Caretakers can manage the parts you grant them permission for — never ownership or money.'
            : 'Properties that were assigned to you appear here.'}
        </p>
        {isLandlord && (
          <button type="button" className="btn btn-primary" onClick={onAssign} style={{ gap: 8 }}>
            <Plus size={16} /> Assign caretaker
          </button>
        )}
      </div>

      {assignments.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <Users size={36} color="var(--muted)" style={{ marginBottom: 12 }} />
          <h3 style={{ margin: '0 0 6px' }}>No assignments</h3>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            {isLandlord ? 'Assign a verified caretaker to a listing to let them help you manage it.' : 'A landlord has not assigned you anything yet.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-alt)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px' }}>Property</th>
                <th style={{ padding: '12px 16px' }}>Caretaker / Landlord</th>
                <th style={{ padding: '12px 16px' }}>Permissions</th>
                <th style={{ padding: '12px 16px' }}>Status</th>
                {isLandlord && <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontWeight: 700 }}>{a.property_title || '—'}</div>
                    <a href={`/accommodation/${a.property_slug}`} style={{ fontSize: 12, color: 'var(--primary)' }}>view public listing</a>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    {isLandlord ? a.caretaker_name || '—' : a.landlord_name || '—'}
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: 12 }}>
                    {[
                      a.can_create_advert && 'advertise',
                      a.can_edit_details && 'edit',
                      a.can_manage_images && (a.can_edit_details ? '' : 'photos'),
                      a.can_change_availability && 'availability',
                      a.can_mark_rented && 'rented'
                    ].filter(Boolean).join(', ') || 'view only'}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span className="badge" style={{ background: a.status === 'active' ? 'var(--success-bg)' : 'var(--surface-alt)', color: a.status === 'active' ? '#047857' : 'var(--text-secondary)', fontWeight: 700 }}>
                      {a.status}
                    </span>
                  </td>
                  {isLandlord && (
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      {a.status === 'active' ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', color: 'var(--red-700)', fontSize: 12 }}
                          onClick={() => void onRevoke(a.id)}
                        >
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AssignModal({ properties, onClose, onDone }: { properties: ProviderProperty[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '');
  const [email, setEmail] = useState('');
  const [perms, setPerms] = useState({
    canCreateAdvert: false,
    canEditDetails: false,
    canManageImages: true,
    canChangeAvailability: true,
    canMarkRented: true
  });

  if (properties.length === 0) {
    return (
      <div className="drawer-overlay" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
        <div className="card" style={{ maxWidth: 480, width: '100%', padding: 24, borderRadius: 14 }}>
          <h3 style={{ margin: '0 0 8px' }}>No published listings to assign</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Create and submit a listing before assigning a caretaker.</p>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId || !email.trim()) {
      toast('Choose a property and enter the caretaker email.', 'error');
      return;
    }
    setBusy(true);
    try {
      await assignCaretaker({
        propertyId,
        caretakerEmail: email.trim(),
        canCreateAdvert: perms.canCreateAdvert,
        canEditDetails: perms.canEditDetails,
        canManageImages: perms.canManageImages,
        canChangeAvailability: perms.canChangeAvailability,
        canMarkRented: perms.canMarkRented
      });
      toast('Caretaker assigned.', 'success');
      await onDone();
    } catch (err: any) {
      toast(err?.message || 'Could not assign caretaker.', 'error');
      setBusy(false);
    }
  };

  return (
    <div className="drawer-overlay" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 520, width: '100%', padding: 24, borderRadius: 14 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800 }}>Assign caretaker</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Property *">
            <select className="form-select" style={{ width: '100%' }} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </Field>
          <Field label="Caretaker account email *">
            <input className="form-input" style={{ width: '100%' }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="caretaker@example.com" />
          </Field>
          <Field label="Permissions">
            <div style={{ display: 'grid', gap: 6 }}>
              {([
                ['canCreateAdvert', 'Create & submit adverts'],
                ['canEditDetails', 'Edit listing details'],
                ['canManageImages', 'Manage photos'],
                ['canChangeAvailability', 'Change availability / remove'],
                ['canMarkRented', 'Mark as rented']
              ] as const).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={perms[key]} onChange={() => setPerms((p) => ({ ...p, [key]: !p[key] }))} />
                  {label}
                </label>
              ))}
            </div>
          </Field>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={onClose} className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
            <button type="submit" disabled={busy} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
              {busy ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SettingsTab({
  provider,
  isLandlord,
  onSaved
}: {
  provider: ProviderProfile;
  isLandlord: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { profile: userProfile, updateProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState(provider.full_name ?? userProfile?.fullName ?? '');
  const [businessName, setBusinessName] = useState(provider.business_name ?? '');
  const [phone, setPhone] = useState(provider.phone ?? userProfile?.phoneNumber ?? '');
  const [preferredContact, setPreferredContact] = useState(provider.preferred_contact_method ?? 'phone');
  const [stateName, setStateName] = useState(provider.state ?? '');
  const [lga, setLga] = useState(provider.lga ?? '');
  const [town, setTown] = useState(provider.town ?? '');
  const [address, setAddress] = useState(provider.address ?? '');
  const [ownershipStatus, setOwnershipStatus] = useState(provider.ownership_status ?? 'owner');
  const [propertiesCount, setPropertiesCount] = useState(provider.properties_count != null ? String(provider.properties_count) : '');
  const [intendedLocation, setIntendedLocation] = useState(provider.intended_location ?? '');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fullName.trim().length < 3 || phone.replace(/\D/g, '').length < 10) {
      toast('Enter your full name and a valid phone number.', 'error');
      return;
    }
    setBusy(true);
    try {
      const count = propertiesCount.trim() ? Number(propertiesCount) : undefined;
      await registerProvider({
        accountType: (provider.provider_type ?? (isLandlord ? 'landlord' : 'caretaker')),
        fullName: fullName.trim(),
        phone: phone.trim(),
        state: stateName.trim() || undefined,
        lga: lga.trim() || undefined,
        town: town.trim() || undefined,
        address: address.trim() || undefined,
        preferredContact,
        ownershipStatus,
        propertiesCount: Number.isFinite(count) ? count : undefined,
        intendedLocation: intendedLocation.trim() || undefined,
        businessName: businessName.trim() || undefined
      });

      // Keep the trusted FUW profile in sync so these details never need to be
      // re-entered anywhere else in the app.
      const profileSync: { fullName?: string; phoneNumber?: string } = {};
      if (fullName.trim() && fullName.trim() !== userProfile?.fullName) {
        profileSync.fullName = fullName.trim();
      }
      if (phone.trim() && phone.trim() !== userProfile?.phoneNumber) {
        profileSync.phoneNumber = phone.trim();
      }
      if (Object.keys(profileSync).length > 0) {
        await updateProfile(profileSync).catch(() => null);
      }

      toast('Provider details saved.', 'success');
      await onSaved();
    } catch (err: any) {
      toast(err?.message || 'Could not save details.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800 }}>Verification status</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge" style={{ fontWeight: 700 }}>{provider.verification_status}</span>
          {provider.is_suspended ? (
            <span style={{ fontSize: 12, color: 'var(--red-700)' }}>Account suspended</span>
          ) : null}
        </div>
        {provider.rejection_reason ? (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--red-700)' }}>Reason: {provider.rejection_reason}</p>
        ) : (
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
            Verified providers can submit paid advertisements. Suspended or rejected accounts cannot.
          </p>
        )}
      </div>

      <form onSubmit={save} className="card" style={{ padding: 18 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 800 }}>Contact & identity</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Field label="Full legal name *">
            <input className="form-input" style={{ width: '100%' }} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Business name">
            <input className="form-input" style={{ width: '100%' }} value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </Field>
          <Field label="Phone *">
            <input className="form-input" style={{ width: '100%' }} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Preferred contact">
            <select className="form-select" style={{ width: '100%' }} value={preferredContact} onChange={(e) => setPreferredContact(e.target.value)}>
              <option value="phone">Phone call</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          </Field>
          <Field label="State">
            <input className="form-input" style={{ width: '100%' }} value={stateName} onChange={(e) => setStateName(e.target.value)} />
          </Field>
          <Field label="LGA">
            <input className="form-input" style={{ width: '100%' }} value={lga} onChange={(e) => setLga(e.target.value)} />
          </Field>
          <Field label="Town / area">
            <input className="form-input" style={{ width: '100%' }} value={town} onChange={(e) => setTown(e.target.value)} />
          </Field>
          <Field label="Contact address">
            <input className="form-input" style={{ width: '100%' }} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          {isLandlord ? (
            <>
              <Field label="Ownership">
                <select className="form-select" style={{ width: '100%' }} value={ownershipStatus} onChange={(e) => setOwnershipStatus(e.target.value)}>
                  <option value="owner">I own the property</option>
                  <option value="family">Family-owned property</option>
                  <option value="manager">I manage it for the owner</option>
                  <option value="agent">I am an agent</option>
                </select>
              </Field>
              <Field label="Number of properties">
                <input className="form-input" style={{ width: '100%' }} type="number" min={0} value={propertiesCount} onChange={(e) => setPropertiesCount(e.target.value)} />
              </Field>
            </>
          ) : (
            <Field label="Properties you manage (area)">
              <input className="form-input" style={{ width: '100%' }} value={intendedLocation} onChange={(e) => setIntendedLocation(e.target.value)} />
            </Field>
          )}
        </div>
        <button type="submit" disabled={busy} className="btn btn-primary" style={{ gap: 8, marginTop: 8 }}>
          {busy ? <><Loader2 className="animate-spin" size={16} /> Saving…</> : <><Check size={16} /> Save details</>}
        </button>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: '1 1 auto' }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

export default AccommodationPortal;