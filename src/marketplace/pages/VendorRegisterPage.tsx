import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Store, ArrowRight } from 'lucide-react';
import { saveVendor } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Skeleton } from '../components/Skeleton';
import { mpPath, PLATFORM_PATHS } from '../lib/routes';

export const VendorRegisterPage: React.FC = () => {
  const { user, profile, vendor, refreshAuth, isLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [storeName, setStoreName] = useState('');
  const [slug, setSlug] = useState('');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [campusArea, setCampusArea] = useState('Male Hostel A');
  const [bankName, setBankName] = useState('Opay');
  const [accountNumber, setAccountNumber] = useState('');
  const [busy, setBusy] = useState(false);

  const handleNameChange = (val: string) => {
    setStoreName(val);
    const autoSlug = val
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    setSlug(autoSlug);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast('Please sign in to register a storefront', 'info');
      navigate(PLATFORM_PATHS.login);
      return;
    }

    if (storeName.trim().length < 3) {
      toast('Store name must be at least 3 characters', 'error');
      return;
    }

    if (!slug.trim() || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim())) {
      toast('Invalid store slug format (lowercase letters, numbers and hyphens only)', 'error');
      return;
    }

    if (phone.trim().length < 7) {
      toast('Please enter a valid phone number', 'error');
      return;
    }

    setBusy(true);
    try {
      await saveVendor({
        store_name: storeName.trim(),
        slug: slug.trim(),
        phone: phone.trim(),
        tagline: tagline.trim() || undefined,
        description: description.trim() || undefined,
        campus_area: campusArea,
        payout_bank_name: bankName,
        payout_account_number: accountNumber.trim() || undefined,
      });

      await refreshAuth();
      toast('Storefront created successfully! Welcome to FUW Vendor Hub.', 'success');
      navigate(mpPath('/vendor/dashboard'));
    } catch (err: any) {
      console.error('Vendor registration error:', err);
      toast(err.message || 'Failed to register storefront. The slug may already be taken.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ maxWidth: 520, margin: '60px auto', padding: '0 16px' }}>
        <Skeleton height={120} borderRadius={16} />
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton height={60} borderRadius={10} />
          <Skeleton height={60} borderRadius={10} />
          <Skeleton height={120} borderRadius={10} />
        </div>
      </div>
    );
  }

  if (vendor) {
    return (
      <div style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center', padding: '40px 24px', background: 'var(--surface, #ffffff)', borderRadius: 16, border: '1px solid var(--border, #dcebe0)' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--green-100, #e8f5ec)', color: 'var(--green-800, #12603d)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <Store size={32} />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>You already have an active storefront!</h2>
        <p style={{ color: 'var(--text-secondary, #55675b)', margin: '0 0 24px', fontSize: 14 }}>
          Store: <strong>{vendor.store_name}</strong> ({vendor.status.replace(/_/g, ' ').toUpperCase()})
        </p>
        <Link to={mpPath("/vendor/dashboard")} className="btn btn-primary" style={{ padding: '10px 22px' }}>
          Open Vendor Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '30px auto 80px', padding: '0 16px' }}>
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-800, #12603d)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Campus Commerce
        </span>
        <h1 style={{ margin: '6px 0 10px', fontSize: 28, fontWeight: 800, color: 'var(--text-primary, #17231d)' }}>
          Open Your FUW Storefront
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary, #55675b)', lineHeight: 1.5 }}>
          Sell physical products or offer student services with protected campus escrow settlements.
        </p>
      </div>

      <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 16, border: '1px solid var(--border, #dcebe0)', padding: 28, boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(18, 96, 61, 0.08))' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              Storefront Name *
            </label>
            <input
              type="text"
              required
              value={storeName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Audu's Tech & Phones / Grace Bakes & Food"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              Store URL Slug *
            </label>
            {/* The prefix and slug share one line: both may shrink, and the
                prefix truncates, so the row never pushes past the card. */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '10px 12px', background: 'var(--surface-alt, #f4f8f5)', border: '1px solid var(--border, #dcebe0)', borderRight: 'none', borderRadius: '8px 0 0 8px', fontSize: 13, color: 'var(--muted, #55675b)' }}>
                fuw.marketplace/vendor/
              </span>
              <input
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="store-slug"
                style={{ flex: '1 1 auto', minWidth: 0, padding: '10px 14px', borderRadius: '0 8px 8px 0', border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              Business Tagline
            </label>
            <input
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g. Fast phone screen repairs & affordable electronics in Wukari"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
            />
          </div>

          <div className="mp-field-grid" style={{ display: 'grid', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                Contact Phone / WhatsApp *
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08012345678"
                style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                Primary Campus Location *
              </label>
              <select
                value={campusArea}
                onChange={(e) => setCampusArea(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#ffffff' }}
              >
                <option value="Male Hostel A">Male Hostel A</option>
                <option value="Male Hostel B">Male Hostel B</option>
                <option value="Female Hostel A">Female Hostel A</option>
                <option value="Female Hostel B">Female Hostel B</option>
                <option value="New Site Campus">New Site Campus</option>
                <option value="Permanent Site">Permanent Site</option>
                <option value="Faculty of Science">Faculty of Science</option>
                <option value="Faculty of Computing">Faculty of Computing</option>
                <option value="Off-Campus Wukari">Off-Campus Wukari</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              About Your Store / Services
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell fellow students what products or services you offer, turnaround time, and delivery methods..."
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
            />
          </div>

          {/* Payout Details Section */}
          <div style={{ paddingTop: 16, borderTop: '1px solid var(--border, #dcebe0)' }}>
            <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Bank Payout Information (Optional)</h4>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
              Where you would like your customer order settlements transferred to upon completion.
            </p>

            <div className="mp-field-grid" style={{ display: 'grid', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Bank Name</label>
                <select
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#ffffff' }}
                >
                  <option value="Opay">Opay</option>
                  <option value="Palmpay">Palmpay</option>
                  <option value="Moniepoint">Moniepoint</option>
                  <option value="Kuda Bank">Kuda Bank</option>
                  <option value="Access Bank">Access Bank</option>
                  <option value="GTBank">Guaranty Trust Bank</option>
                  <option value="First Bank">First Bank of Nigeria</option>
                  <option value="UBA">United Bank for Africa</option>
                  <option value="Zenith Bank">Zenith Bank</option>
                  <option value="Fidelity Bank">Fidelity Bank</option>
                  <option value="Union Bank">Union Bank</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Account Number</label>
                <input
                  type="text"
                  maxLength={10}
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="10 digit account number"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary"
            style={{ width: '100%', padding: '13px', fontSize: 15, marginTop: 8 }}
          >
            <span>{busy ? 'Creating Storefront...' : 'Launch My Storefront'}</span>
            <ArrowRight size={16} />
          </button>
        </form>
      </div>
    </div>
  );
};
