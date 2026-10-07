import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MapPin,
  Plus,
  Trash2,
  CheckCircle,
  Store,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { fetchAddresses, saveAddress, deleteAddress } from '../lib/api';
import type { MarketplaceAddress } from '../lib/types';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Skeleton } from '../components/Skeleton';
import { mpPath, PLATFORM_PATHS } from '../lib/routes';

export const ProfilePage: React.FC = () => {
  const { user, profile, vendor, signOut, isLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [addresses, setAddresses] = useState<MarketplaceAddress[]>([]);
  const [loading, setLoading] = useState(true);

  // Address modal
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [editAddressId, setEditAddressId] = useState<string | null>(null);
  const [label, setLabel] = useState('My Hostel');
  const [recipientName, setRecipientName] = useState('');
  const [phone, setPhone] = useState('');
  const [campusArea, setCampusArea] = useState('Male Hostel A');
  const [addressLine, setAddressLine] = useState('');
  const [landmark, setLandmark] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadAddresses = async () => {
    setLoading(true);
    try {
      const list = await fetchAddresses();
      setAddresses(list);
    } catch (err) {
      console.error('Failed to load addresses:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate(PLATFORM_PATHS.login);
      return;
    }
    loadAddresses();
  }, [isLoading, user]);

  const handleOpenAddAddress = () => {
    setEditAddressId(null);
    setLabel('My Hostel');
    setRecipientName(profile?.full_name || '');
    setPhone(profile?.phone || '');
    setCampusArea(profile?.campus_hostel || 'Male Hostel A');
    setAddressLine('');
    setLandmark('');
    setIsDefault(addresses.length === 0);
    setAddressModalOpen(true);
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientName.trim() || !phone.trim() || !addressLine.trim()) {
      toast('Please fill in all required address fields', 'error');
      return;
    }

    setBusy(true);
    try {
      await saveAddress({
        id: editAddressId || undefined,
        label,
        recipient_name: recipientName.trim(),
        phone: phone.trim(),
        campus_area: campusArea,
        address_line: addressLine.trim(),
        landmark: landmark.trim() || undefined,
        is_default: isDefault,
      });
      toast('Delivery address saved successfully', 'success');
      setAddressModalOpen(false);
      loadAddresses();
    } catch (err: any) {
      toast(err.message || 'Failed to save address', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAddress = async (addressId: string) => {
    try {
      await deleteAddress(addressId);
      toast('Address removed', 'info');
      loadAddresses();
    } catch (err: any) {
      toast(err.message || 'Failed to delete address', 'error');
    }
  };

  if (isLoading) {
    return (
      <div style={{ paddingBottom: 60, maxWidth: 840, margin: '0 auto' }}>
        <Skeleton height={100} borderRadius={14} />
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton height={180} borderRadius={14} />
          <Skeleton height={200} borderRadius={14} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 60, maxWidth: 840, margin: '0 auto' }}>
      {/* Title */}
      <div style={{ marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid var(--border, #dcebe0)' }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text-primary, #17231d)' }}>
          My Account & Delivery Profile
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary, #55675b)' }}>
          Your verified Federal University Wukari student identity and campus delivery address book
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Student Identity Card */}
        <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'var(--green-800, #12603d)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: 20,
                }}
              >
                {profile?.full_name ? profile.full_name.charAt(0).toUpperCase() : 'U'}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{profile?.full_name || 'FUW Student'}</h3>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#d1fae5', color: '#065f46', padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                    <CheckCircle size={12} /> Verified Student
                  </span>
                </div>
                <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                  Matric: {profile?.matric_number || 'Registered Student'}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => signOut()}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: '1px solid #fca5a5',
                background: '#fee2e2',
                color: '#991b1b',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 16, paddingTop: 16, borderTop: '1px solid var(--border, #dcebe0)', fontSize: 13 }}>
            <div>
              <span style={{ color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 2 }}>Faculty</span>
              <strong>{profile?.faculty || 'FUW Faculty'}</strong>
            </div>

            <div>
              <span style={{ color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 2 }}>Department</span>
              <strong>{profile?.department || 'Curriculum Student'}</strong>
            </div>

            <div>
              <span style={{ color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 2 }}>Level</span>
              <strong>{profile?.level || 'Undergraduate'}</strong>
            </div>

            <div>
              <span style={{ color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 2 }}>Email</span>
              <strong>{user?.email}</strong>
            </div>
          </div>
        </div>

        {/* Vendor Status Section */}
        <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--green-100, #e8f5ec)', color: 'var(--green-800, #12603d)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Store size={22} />
              </div>
              <div>
                <h4 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>
                  {vendor ? vendor.store_name : 'Campus Vendor Storefront'}
                </h4>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                  {vendor
                    ? `Status: ${vendor.status.toUpperCase()} · ${vendor.completed_orders_count || 0} completed orders`
                    : 'Sell products or campus services to students across Federal University Wukari'}
                </p>
              </div>
            </div>

            {vendor ? (
              <Link to={mpPath("/vendor/dashboard")} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}>
                Open Vendor Dashboard
              </Link>
            ) : (
              <Link to={mpPath("/vendor/register")} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}>
                Open a Storefront
              </Link>
            )}
          </div>
        </div>

        {/* Campus Address Book */}
        <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700 }}>Saved Campus Delivery Addresses</h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                Addresses for food, books, and parcel delivery across campus hostels and faculties
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenAddAddress}
              className="btn btn-secondary"
              style={{ padding: '8px 14px', fontSize: 13 }}
            >
              <Plus size={15} />
              <span>Add Address</span>
            </button>
          </div>

          {loading ? (
            <p style={{ color: 'var(--muted, #55675b)', fontSize: 13, margin: 0 }}>
              Loading saved addresses...
            </p>
          ) : addresses.length === 0 ? (
            <p style={{ color: 'var(--muted, #55675b)', fontSize: 13, margin: 0 }}>
              No saved addresses. Add your hostel room or faculty spot for faster checkout.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {addresses.map((addr) => (
                <div
                  key={addr.id}
                  style={{
                    padding: 16,
                    borderRadius: 10,
                    border: '1px solid var(--border, #dcebe0)',
                    background: addr.is_default ? 'var(--green-100, #e8f5ec)' : 'var(--surface-alt, #f4f8f5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <MapPin size={18} color="var(--green-800, #12603d)" style={{ marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <strong style={{ fontSize: 14 }}>{addr.label}</strong>
                        {addr.is_default && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'var(--green-800, #12603d)', color: '#ffffff' }}>
                            DEFAULT
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 13, color: 'var(--text-primary, #17231d)', display: 'block' }}>
                        {addr.recipient_name} · {addr.phone}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        {addr.campus_area} · {addr.address_line} {addr.landmark ? `(near ${addr.landmark})` : ''}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteAddress(addr.id)}
                    style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', padding: 6 }}
                    title="Delete address"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Address Modal */}
      <Modal isOpen={addressModalOpen} onClose={() => setAddressModalOpen(false)} title="Add Campus Delivery Address" maxWidth="480px">
        <form onSubmit={handleSaveAddress} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Address Label</label>
            <input
              type="text"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. My Hostel, Faculty Block"
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
            />
          </div>

          <div className="mp-field-grid" style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Recipient Name *</label>
              <input
                type="text"
                required
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Full Name"
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Phone Number *</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08012345678"
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
              />
            </div>
          </div>

          <div className="mp-field-grid" style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Campus Area *</label>
              <select
                value={campusArea}
                onChange={(e) => setCampusArea(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#ffffff' }}
              >
                <option value="Male Hostel A">Male Hostel A</option>
                <option value="Male Hostel B">Male Hostel B</option>
                <option value="Female Hostel A">Female Hostel A</option>
                <option value="Female Hostel B">Female Hostel B</option>
                <option value="New Site Hostels">New Site Hostels</option>
                <option value="Faculty of Science">Faculty of Science</option>
                <option value="Faculty of Computing">Faculty of Computing</option>
                <option value="Off-Campus Wukari">Off-Campus Wukari</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Room / Block *</label>
              <input
                type="text"
                required
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
                placeholder="Room 12, Block B"
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Landmark (optional)</label>
            <input
              type="text"
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
              placeholder="e.g. Near university clinic"
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            <span>Set as default delivery address</span>
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setAddressModalOpen(false)}
              disabled={busy}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--green-800, #12603d)', color: '#ffffff', fontWeight: 600, cursor: 'pointer' }}
            >
              {busy ? 'Saving...' : 'Save Address'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
