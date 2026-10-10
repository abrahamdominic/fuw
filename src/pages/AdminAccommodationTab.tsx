import React, { useState, useEffect, useCallback } from 'react';
import {
  Home,
  Plus,
  Search,
  CheckCircle,
  XCircle,
  ShieldCheck,
  Edit,
  Trash2,
  AlertTriangle,
  Flag,
  Phone,
  Eye,
  RefreshCw,
  ExternalLink,
  MapPin,
  Clock,
  Upload,
  Loader2,
  BadgeCheck,
  Ban,
  FileText,
  Settings as SettingsIcon,
  Wallet,
  UserCheck
} from 'lucide-react';
import { requireSupabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { ConfirmDialog, PromptDialog } from '../components/ConfirmDialog';
import {
  AccommodationProperty,
  ACCOMMODATION_LOCATIONS,
  PROPERTY_TYPES,
  POPULAR_AMENITIES,
  formatNaira,
  getPropertyTypeLabel
} from '../lib/accommodation';
import {
  adminListAdverts,
  adminListProviderApplications,
  adminReviewAdvert,
  adminReviewProviderApplication,
  adminUpdateAdvertSettings,
  fetchAdvertSettings,
  signProviderDocument,
  type AdminAdvert,
  type AdvertSettings,
  type ModerationStatus,
  type ProviderApplication,
  type VerificationStatus
} from '../lib/accommodationPortal';
import { fx } from '../lib/motion';

type SubTab = 'listings' | 'reports' | 'applications' | 'adverts' | 'settings';

export function AdminAccommodationTab() {
  const supabase = requireSupabase();
  const { toast } = useToast();
  const [properties, setProperties] = useState<AccommodationProperty[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('listings');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('All Locations');

  // Modal form states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationArea, setLocationArea] = useState<any>('New Site');
  const [addressLandmark, setAddressLandmark] = useState('');
  const [distanceToCampus, setDistanceToCampus] = useState('');
  const [propertyType, setPropertyType] = useState<any>('self_contained');
  const [priceAnnual, setPriceAnnual] = useState(150000);
  const [priceSemester, setPriceSemester] = useState(85000);
  const [cautionDeposit, setCautionDeposit] = useState(10000);
  const [serviceCharge, setServiceCharge] = useState(5000);
  const [availableUnits, setAvailableUnits] = useState(4);
  const [availabilityStatus, setAvailabilityStatus] = useState<any>('available');
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>(['Running Water', 'Prepaid Meter / Light', 'Fenced & Gated']);
  const [rulesNotes, setRulesNotes] = useState('');

  const handleImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) {
      toast('Please upload a valid image file (JPG, PNG, WebP, or AVIF)', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast('Image file size must be less than 5MB', 'error');
      return;
    }

    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`;
      const filePath = `properties/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('accommodation-images')
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('accommodation-images')
        .getPublicUrl(filePath);

      setImageUrl(data.publicUrl);
      toast('Property photo uploaded successfully', 'success');
    } catch (err: any) {
      console.error('Image upload failed:', err);
      toast(err.message || 'Failed to upload photo', 'error');
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<AccommodationProperty | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [propRes, repRes] = await Promise.all([
        supabase
          .from('accommodation_properties')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('accommodation_reports')
          .select('*, property:accommodation_properties(title, slug, contact_phone)')
          .order('created_at', { ascending: false })
      ]);

      if (propRes.data) setProperties(propRes.data as AccommodationProperty[]);
      if (repRes.data) setReports(repRes.data);
    } catch (err: any) {
      toast('Failed to load accommodation data', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setLocationArea('New Site');
    setAddressLandmark('');
    setDistanceToCampus('5 mins walk to Campus Gate');
    setPropertyType('self_contained');
    setPriceAnnual(140000);
    setPriceSemester(80000);
    setCautionDeposit(10000);
    setServiceCharge(5000);
    setAvailableUnits(3);
    setAvailabilityStatus('available');
    setContactPhone('');
    setContactWhatsapp('');
    setImageUrl('https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=80');
    setSelectedAmenities(['Running Water', 'Prepaid Meter / Light', 'Fenced & Gated']);
    setRulesNotes('');
    setModalOpen(true);
  };

  const openEditModal = (prop: AccommodationProperty) => {
    setEditingId(prop.id);
    setTitle(prop.title);
    setDescription(prop.description);
    setLocationArea(prop.location_area);
    setAddressLandmark(prop.address_landmark);
    setDistanceToCampus(prop.distance_to_campus || '');
    setPropertyType(prop.property_type);
    setPriceAnnual(prop.price_annual);
    setPriceSemester(prop.price_semester || 0);
    setCautionDeposit(prop.caution_deposit);
    setServiceCharge(prop.service_charge);
    setAvailableUnits(prop.available_units);
    setAvailabilityStatus(prop.availability_status);
    setContactPhone(prop.contact_phone);
    setContactWhatsapp(prop.contact_whatsapp || '');
    setImageUrl(prop.images[0] || '');
    setSelectedAmenities(prop.amenities || []);
    setRulesNotes(prop.rules_notes || '');
    setModalOpen(true);
  };

  const handleSaveProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !addressLandmark.trim() || !contactPhone.trim()) {
      toast('Please fill in property title, address and contact phone', 'error');
      return;
    }

    setFormBusy(true);
    const slug =
      editingId && properties.find((p) => p.id === editingId)?.slug
        ? properties.find((p) => p.id === editingId)!.slug
        : `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString().slice(-4)}`;

    const payload = {
      title: title.trim(),
      slug,
      description: description.trim(),
      location_area: locationArea,
      address_landmark: addressLandmark.trim(),
      distance_to_campus: distanceToCampus.trim() || null,
      property_type: propertyType,
      price_annual: priceAnnual,
      price_semester: priceSemester > 0 ? priceSemester : null,
      caution_deposit: cautionDeposit,
      service_charge: serviceCharge,
      available_units: availableUnits,
      availability_status: availabilityStatus,
      contact_phone: contactPhone.trim(),
      contact_whatsapp: contactWhatsapp.trim() || null,
      images: imageUrl ? [imageUrl] : ['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=80'],
      amenities: selectedAmenities,
      rules_notes: rulesNotes.trim() || null
    };

    try {
      if (editingId) {
        const { error } = await supabase
          .from('accommodation_properties')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
        toast('Accommodation listing updated successfully!', 'success');
      } else {
        const { error } = await supabase
          .from('accommodation_properties')
          .insert({ ...payload, is_verified: true, is_published: true });
        if (error) throw error;
        toast('New accommodation listing created and published!', 'success');
      }

      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      toast(err.message || 'Failed to save accommodation listing', 'error');
    } finally {
      setFormBusy(false);
    }
  };

  const toggleVerification = async (prop: AccommodationProperty) => {
    try {
      const { error } = await supabase
        .from('accommodation_properties')
        .update({ is_verified: !prop.is_verified })
        .eq('id', prop.id);
      if (error) throw error;
      toast(`Lodge ${!prop.is_verified ? 'verified' : 'unverified'}`, 'success');
      setProperties((prev) =>
        prev.map((p) => (p.id === prop.id ? { ...p, is_verified: !prop.is_verified } : p))
      );
    } catch (err: any) {
      toast('Failed to update verification status', 'error');
    }
  };

  const togglePublished = async (prop: AccommodationProperty) => {
    try {
      const { error } = await supabase
        .from('accommodation_properties')
        .update({ is_published: !prop.is_published })
        .eq('id', prop.id);
      if (error) throw error;
      toast(`Listing ${!prop.is_published ? 'published' : 'unpublished'}`, 'success');
      setProperties((prev) =>
        prev.map((p) => (p.id === prop.id ? { ...p, is_published: !prop.is_published } : p))
      );
    } catch (err: any) {
      toast('Failed to update publish status', 'error');
    }
  };

  const handleDeleteProperty = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase
        .from('accommodation_properties')
        .delete()
        .eq('id', deleteTarget.id);
      if (error) throw error;
      toast('Property deleted permanently', 'success');
      setProperties((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: any) {
      toast('Failed to delete property', 'error');
    }
  };

  const updateReportStatus = async (reportId: string, status: string) => {
    try {
      const { error } = await supabase
        .from('accommodation_reports')
        .update({ status })
        .eq('id', reportId);
      if (error) throw error;
      toast(`Report status updated to ${status}`, 'success');
      setReports((prev) =>
        prev.map((r) => (r.id === reportId ? { ...r, status } : r))
      );
    } catch (err: any) {
      toast('Failed to update report status', 'error');
    }
  };

  const filteredProperties = properties.filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.address_landmark.toLowerCase().includes(search.toLowerCase());
    const matchesLoc =
      selectedLocation === 'All Locations' || p.location_area === selectedLocation;
    return matchesSearch && matchesLoc;
  });

  return (
    <div className={`admin-accommodation-tab ${fx.fadeIn}`}>
      {/* Header controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>
            FUW Accommodation &amp; Lodges Management
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Manage off-campus student lodges, private apartments, caretakers, verified status, and investigate safety reports.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={openCreateModal}
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', fontWeight: 700 }}
          >
            <Plus size={16} /> Add New Lodge Listing
          </button>
          <button
            type="button"
            onClick={loadData}
            className="btn btn-secondary"
            title="Refresh listings"
            style={{ padding: '10px 14px' }}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Sub Tabs: Listings vs Reports */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setActiveSubTab('listings')}
          className={`tab-btn ${activeSubTab === 'listings' ? 'active' : ''}`}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            fontWeight: activeSubTab === 'listings' ? 800 : 500,
            color: activeSubTab === 'listings' ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: activeSubTab === 'listings' ? '3px solid var(--primary)' : '3px solid transparent',
            cursor: 'pointer'
          }}
        >
          All Accommodations ({properties.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('reports')}
          className={`tab-btn ${activeSubTab === 'reports' ? 'active' : ''}`}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            fontWeight: activeSubTab === 'reports' ? 800 : 500,
            color: activeSubTab === 'reports' ? 'var(--red-700)' : 'var(--text-secondary)',
            borderBottom: activeSubTab === 'reports' ? '3px solid var(--red-700)' : '3px solid transparent',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <Flag size={15} /> Safety Reports ({reports.filter((r) => r.status === 'pending').length} pending)
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('applications')}
          className={`tab-btn ${activeSubTab === 'applications' ? 'active' : ''}`}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            fontWeight: activeSubTab === 'applications' ? 800 : 500,
            color: activeSubTab === 'applications' ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: activeSubTab === 'applications' ? '3px solid var(--primary)' : '3px solid transparent',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <UserCheck size={15} /> Provider Applications
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('adverts')}
          className={`tab-btn ${activeSubTab === 'adverts' ? 'active' : ''}`}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            fontWeight: activeSubTab === 'adverts' ? 800 : 500,
            color: activeSubTab === 'adverts' ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: activeSubTab === 'adverts' ? '3px solid var(--primary)' : '3px solid transparent',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <CheckCircle size={15} /> Advert Moderation
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('settings')}
          className={`tab-btn ${activeSubTab === 'settings' ? 'active' : ''}`}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            fontWeight: activeSubTab === 'settings' ? 800 : 500,
            color: activeSubTab === 'settings' ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: activeSubTab === 'settings' ? '3px solid var(--primary)' : '3px solid transparent',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <SettingsIcon size={15} /> Advert Fee Settings
        </button>
      </div>

      {activeSubTab === 'listings' && (
        <>
          {/* Filters Bar */}
          <div className="card" style={{ padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 240px' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input
                type="text"
                placeholder="Search by lodge name or landmark..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="form-input"
                style={{ width: '100%', paddingLeft: 36, fontSize: 13 }}
              />
            </div>

            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="form-select"
              style={{ fontSize: 13, minWidth: 160 }}
            >
              {ACCOMMODATION_LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>

          {/* Properties Table */}
          {loading ? (
            <div className="empty-state card" style={{ padding: 48, textAlign: 'center' }}>
              <span className="route-fallback-spinner" />
              <p>Loading accommodation listings...</p>
            </div>
          ) : filteredProperties.length === 0 ? (
            <div className="empty-state card" style={{ padding: 48, textAlign: 'center' }}>
              <Home size={40} color="var(--muted)" style={{ marginBottom: 12 }} />
              <h3>No Accommodations Found</h3>
              <p style={{ color: 'var(--text-secondary)' }}>Click "Add New Lodge Listing" to publish a property.</p>
            </div>
          ) : (
            <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-alt)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 16px' }}>Lodge &amp; Location</th>
                    <th style={{ padding: '12px 16px' }}>Type</th>
                    <th style={{ padding: '12px 16px' }}>Price / Yr</th>
                    <th style={{ padding: '12px 16px' }}>Caretaker</th>
                    <th style={{ padding: '12px 16px' }}>Availability</th>
                    <th style={{ padding: '12px 16px' }}>Status</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProperties.map((prop) => (
                    <tr key={prop.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{prop.title}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                          {prop.location_area} · {prop.address_landmark}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span className="pill-badge" style={{ fontSize: 11 }}>
                          {getPropertyTypeLabel(prop.property_type)}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', fontWeight: 700, color: 'var(--green-800)' }}>
                        {formatNaira(prop.price_annual)}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div>{prop.contact_phone}</div>
                        {prop.contact_whatsapp && (
                          <div style={{ fontSize: 11, color: '#16a34a' }}>WhatsApp active</div>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span
                          className="badge"
                          style={{
                            background:
                              prop.availability_status === 'available'
                                ? 'var(--success-bg)'
                                : prop.availability_status === 'fast_filling'
                                ? 'var(--warning-bg)'
                                : 'var(--error-bg)',
                            color:
                              prop.availability_status === 'available'
                                ? '#047857'
                                : prop.availability_status === 'fast_filling'
                                ? 'var(--amber-700)'
                                : 'var(--red-700)',
                            fontSize: 11,
                            fontWeight: 700
                          }}
                        >
                          {prop.availability_status} ({prop.available_units} units)
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => toggleVerification(prop)}
                            style={{
                              background: prop.is_verified ? 'var(--green-100)' : 'var(--surface-alt)',
                              color: prop.is_verified ? 'var(--green-800)' : 'var(--text-secondary)',
                              border: '1px solid var(--border)',
                              borderRadius: 4,
                              padding: '3px 8px',
                              fontSize: 11,
                              cursor: 'pointer',
                              fontWeight: 700
                            }}
                          >
                            {prop.is_verified ? 'Verified ✓' : 'Unverified'}
                          </button>
                          <button
                            type="button"
                            onClick={() => togglePublished(prop)}
                            style={{
                              background: prop.is_published ? 'var(--surface-alt)' : 'var(--error-bg)',
                              color: prop.is_published ? 'var(--text-primary)' : 'var(--red-700)',
                              border: '1px solid var(--border)',
                              borderRadius: 4,
                              padding: '3px 8px',
                              fontSize: 11,
                              cursor: 'pointer',
                              fontWeight: 600
                            }}
                          >
                            {prop.is_published ? 'Published' : 'Hidden'}
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <a
                            href={`/accommodation/${prop.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary"
                            style={{ padding: 6 }}
                            title="View public page"
                          >
                            <Eye size={14} />
                          </a>
                          <button
                            type="button"
                            onClick={() => openEditModal(prop)}
                            className="btn btn-secondary"
                            style={{ padding: 6 }}
                            title="Edit listing"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(prop)}
                            className="btn btn-secondary"
                            style={{ padding: 6, color: 'var(--red-700)' }}
                            title="Delete listing"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeSubTab === 'reports' && (
        /* Reports SubTab */
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          {reports.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
              <ShieldCheck size={36} color="var(--green-800)" style={{ marginBottom: 12 }} />
              <h3>Zero Flagged Accommodation Reports</h3>
              <p>All student lodges currently have a clean safety record.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface-alt)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 16px' }}>Date</th>
                  <th style={{ padding: '12px 16px' }}>Lodge</th>
                  <th style={{ padding: '12px 16px' }}>Report Reason</th>
                  <th style={{ padding: '12px 16px' }}>Details</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((rep) => (
                  <tr key={rep.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                      {new Date(rep.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <strong>{rep.property?.title || 'Unknown property'}</strong>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span className="badge" style={{ background: 'var(--error-bg)', color: 'var(--red-700)', fontWeight: 700 }}>
                        {rep.reason}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', maxWidth: 300 }}>
                      <p style={{ margin: 0, lineHeight: 1.4 }}>{rep.details}</p>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span className="badge" style={{ fontWeight: 700 }}>
                        {rep.status}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => updateReportStatus(rep.id, 'investigating')}
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                        >
                          Investigate
                        </button>
                        <button
                          type="button"
                          onClick={() => updateReportStatus(rep.id, 'resolved')}
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 11, color: 'var(--green-800)' }}
                        >
                          Resolve
                        </button>
                        <button
                          type="button"
                          onClick={() => updateReportStatus(rep.id, 'dismissed')}
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 11, color: 'var(--muted)' }}
                        >
                          Dismiss
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeSubTab === 'applications' && <ApplicationsPanel />}
      {activeSubTab === 'adverts' && <AdvertsPanel />}
      {activeSubTab === 'settings' && <AdvertSettingsPanel />}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="drawer-overlay" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="card" style={{ maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 28, borderRadius: 14 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 19, fontWeight: 800 }}>
              {editingId ? 'Edit Accommodation Listing' : 'Publish New Accommodation Listing'}
            </h3>

            <form onSubmit={handleSaveProperty} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Lodge / Property Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Silver Crest Luxury Student Lodge"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Location Area</label>
                  <select
                    value={locationArea}
                    onChange={(e) => setLocationArea(e.target.value)}
                    className="form-select"
                    style={{ width: '100%' }}
                  >
                    {ACCOMMODATION_LOCATIONS.filter((l) => l !== 'All Locations').map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Room Type</label>
                  <select
                    value={propertyType}
                    onChange={(e) => setPropertyType(e.target.value)}
                    className="form-select"
                    style={{ width: '100%' }}
                  >
                    {PROPERTY_TYPES.filter((t) => t.value !== 'all').map((pt) => (
                      <option key={pt.value} value={pt.value}>
                        {pt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Address / Campus Landmark</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Opposite New Site Gate, Katsina-Ala Road"
                  value={addressLandmark}
                  onChange={(e) => setAddressLandmark(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Annual Rent (₦)</label>
                  <input
                    type="number"
                    required
                    value={priceAnnual}
                    onChange={(e) => setPriceAnnual(Number(e.target.value))}
                    className="form-input"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Semester Option (₦)</label>
                  <input
                    type="number"
                    value={priceSemester}
                    onChange={(e) => setPriceSemester(Number(e.target.value))}
                    className="form-input"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Caretaker Phone Number</label>
                  <input
                    type="tel"
                    required
                    placeholder="08012345678"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="form-input"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>WhatsApp Number</label>
                  <input
                    type="tel"
                    placeholder="2348012345678"
                    value={contactWhatsapp}
                    onChange={(e) => setContactWhatsapp(e.target.value)}
                    className="form-input"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Available Units</label>
                  <input
                    type="number"
                    value={availableUnits}
                    onChange={(e) => setAvailableUnits(Number(e.target.value))}
                    className="form-input"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Availability Status</label>
                  <select
                    value={availabilityStatus}
                    onChange={(e) => setAvailabilityStatus(e.target.value)}
                    className="form-select"
                    style={{ width: '100%' }}
                  >
                    <option value="available">Available</option>
                    <option value="fast_filling">Fast Filling</option>
                    <option value="booked">Booked</option>
                    <option value="under_maintenance">Under Maintenance</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Property Photo</label>
                
                {/* Upload from Device */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      background: 'var(--green-50, #f0fdf4)',
                      border: '1px solid var(--green-600, #16a34a)',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--green-800, #166534)',
                      cursor: uploadingImage ? 'not-allowed' : 'pointer',
                      opacity: uploadingImage ? 0.7 : 1
                    }}
                  >
                    {uploadingImage ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                    {uploadingImage ? 'Uploading photo...' : 'Upload Photo from Device'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      onChange={handleImageFileUpload}
                      disabled={uploadingImage}
                      style={{ display: 'none' }}
                    />
                  </label>
                  <span style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>or enter direct image URL below</span>
                </div>

                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />

                {imageUrl ? (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img
                      src={imageUrl}
                      alt="Property preview"
                      style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border, #ccc)' }}
                      onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>Photo preview</span>
                  </div>
                ) : null}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Description</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>

              {/* Amenities Checkboxes */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Included Amenities</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
                  {POPULAR_AMENITIES.map((amenity) => {
                    const checked = selectedAmenities.includes(amenity);
                    return (
                      <label key={amenity} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (checked) {
                              setSelectedAmenities(selectedAmenities.filter((a) => a !== amenity));
                            } else {
                              setSelectedAmenities([...selectedAmenities, amenity]);
                            }
                          }}
                        />
                        <span>{amenity}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="btn btn-secondary"
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formBusy}
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  {formBusy ? 'Saving...' : editingId ? 'Update Listing' : 'Publish Listing'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          open={true}
          title="Delete Accommodation Listing"
          message={`Are you sure you want to permanently delete "${deleteTarget.title}"? This action cannot be undone.`}
          confirmLabel="Delete Lodge"
          tone="danger"
          onConfirm={handleDeleteProperty}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Provider applications                                                      */
/* -------------------------------------------------------------------------- */

const PROVIDER_STATUS_META: Record<VerificationStatus, { bg: string; fg: string; label: string }> = {
  pending_verification: { bg: 'var(--warning-bg)', fg: 'var(--amber-700)', label: 'Pending verification' },
  verified: { bg: 'var(--success-bg)', fg: '#047857', label: 'Verified' },
  rejected: { bg: 'var(--error-bg)', fg: 'var(--red-700)', label: 'Rejected' },
  suspended: { bg: 'var(--error-bg)', fg: 'var(--red-700)', label: 'Suspended' }
};

function koboToNaira(kobo?: number | null): string {
  return kobo == null ? '—' : formatNaira(kobo / 100);
}

function ApplicationsPanel() {
  const { toast } = useToast();
  const [apps, setApps] = useState<ProviderApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<VerificationStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ app: ProviderApplication; decision: 'approve' | 'suspend' | 'reinstate' } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ProviderApplication | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListProviderApplications(filter === 'all' ? null : filter, 100, 0);
      setApps(res.applications);
      setTotal(res.total);
    } catch (err: any) {
      toast(err?.message || 'Failed to load provider applications.', 'error');
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const review = async (appId: string, decision: 'approve' | 'reject' | 'suspend' | 'reinstate', note?: string) => {
    setBusyId(appId);
    try {
      await adminReviewProviderApplication(appId, decision, note);
      toast('Application updated.', 'success');
      setConfirmTarget(null);
      setRejectTarget(null);
      await load();
    } catch (err: any) {
      toast(err?.message || 'Action failed.', 'error');
      if (decision === 'reject') setRejectTarget(null);
    } finally {
      setBusyId(null);
    }
  };

  const openDocument = async (path: string, label: string) => {
    try {
      const url = await signProviderDocument(path);
      if (!url) {
        toast('Could not generate a secure link for this document.', 'error');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      toast(err?.message || 'Could not open the document.', 'error');
    }
  };

  const evidencePaths = (app: ProviderApplication) =>
    [app.identity_document_path, app.ownership_evidence_path, app.authorization_evidence_path].filter(
      (p): p is string => Boolean(p)
    );

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        {(['all', 'pending_verification', 'verified', 'rejected', 'suspended'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className="btn btn-secondary"
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: filter === f ? 800 : 600,
              background: filter === f ? 'var(--primary)' : undefined,
              color: filter === f ? '#fff' : undefined
            }}
          >
            {f === 'all' ? 'All applications' : PROVIDER_STATUS_META[f as VerificationStatus].label}s
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)', alignSelf: 'center' }}>
          {total} total
        </span>
      </div>

      {loading ? (
        <div className="empty-state" style={{ padding: 48, textAlign: 'center' }}>
          <span className="route-fallback-spinner" />
          <p>Loading provider applications...</p>
        </div>
      ) : apps.length === 0 ? (
        <div className="empty-state" style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <UserCheck size={36} color="var(--muted)" style={{ marginBottom: 12 }} />
          <h3>No provider applications here</h3>
          <p>Applications are filed by landlords and caretakers from the provider registration page.</p>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface-alt)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '12px 16px' }}>Provider</th>
              <th style={{ padding: '12px 16px' }}>Account Type</th>
              <th style={{ padding: '12px 16px' }}>Contact</th>
              <th style={{ padding: '12px 16px' }}>Location</th>
              <th style={{ padding: '12px 16px' }}>Evidence</th>
              <th style={{ padding: '12px 16px' }}>Status</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => {
              const meta = PROVIDER_STATUS_META[app.verification_status];
              const canReview = app.verification_status === 'pending_verification' || app.verification_status === 'rejected';
              return (
                <tr key={app.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontWeight: 700 }}>{app.full_name}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                      {app.email || 'No email'} · {app.role || '—'}
                    </div>
                    {app.business_name && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{app.business_name}</div>
                    )}
                    {app.verification_status === 'rejected' && app.rejection_reason && (
                      <div style={{ fontSize: 12, color: 'var(--red-700)', marginTop: 2 }}>
                        Reason: {app.rejection_reason}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span className="pill-badge" style={{ fontSize: 11 }}>
                      {app.provider_type === 'landlord' ? 'Landlord' : 'Caretaker'}
                    </span>
                    {app.ownership_status && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{app.ownership_status}</div>
                    )}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div>{app.phone}</div>
                    {app.whatsapp && <div style={{ fontSize: 11, color: '#16a34a' }}>WhatsApp: {app.whatsapp}</div>}
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {app.preferred_contact_method || '—'}
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div>{app.town || app.address || app.intended_location || '—'}</div>
                    {app.state && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{app.state}</div>}
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {app.properties_count != null ? `${app.properties_count} property(ies)` : '—'}
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    {evidencePaths(app).length === 0 ? (
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>None uploaded</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        onClick={() => {
                          evidencePaths(app).forEach((path) => void openDocument(path, 'document'));
                        }}
                        title="Open identity / ownership / authorization documents"
                      >
                        <FileText size={13} /> {evidencePaths(app).length} document(s)
                      </button>
                    )}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span className="badge" style={{ background: meta.bg, color: meta.fg, fontWeight: 700 }}>
                      {meta.label}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      {canReview && (
                        <>
                          <button
                            type="button"
                            disabled={busyId === app.id}
                            onClick={() => setConfirmTarget({ app, decision: 'approve' })}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 11, color: '#047857' }}
                          >
                            <BadgeCheck size={14} /> Approve
                          </button>
                          <button
                            type="button"
                            disabled={busyId === app.id}
                            onClick={() => setRejectTarget(app)}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 11, color: 'var(--red-700)' }}
                          >
                            <XCircle size={14} /> Reject
                          </button>
                        </>
                      )}
                      {app.verification_status === 'verified' && (
                        <button
                          type="button"
                          disabled={busyId === app.id}
                          onClick={() => setConfirmTarget({ app, decision: 'suspend' })}
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 11, color: 'var(--red-700)' }}
                        >
                          <Ban size={14} /> Suspend
                        </button>
                      )}
                      {app.verification_status === 'suspended' && (
                        <button
                          type="button"
                          disabled={busyId === app.id}
                          onClick={() => setConfirmTarget({ app, decision: 'reinstate' })}
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 11, color: '#047857' }}
                        >
                          <CheckCircle size={14} /> Reinstate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {confirmTarget && (
        <ConfirmDialog
          open
          title={
            confirmTarget.decision === 'approve'
              ? 'Approve provider?'
              : confirmTarget.decision === 'suspend'
              ? 'Suspend provider?'
              : 'Reinstate provider?'
          }
          message={
            confirmTarget.decision === 'approve'
              ? `Approve ${confirmTarget.app.full_name} as a ${confirmTarget.app.provider_type}? They will be able to list and advertise accommodation.`
              : confirmTarget.decision === 'suspend'
              ? `Suspend ${confirmTarget.app.full_name}? Their listings will stop appearing as live advertisements.`
              : `Reinstate ${confirmTarget.app.full_name}? They will regain verified provider access.`
          }
          confirmLabel={
            confirmTarget.decision === 'approve'
              ? 'Approve'
              : confirmTarget.decision === 'suspend'
              ? 'Suspend'
              : 'Reinstate'
          }
          tone={confirmTarget.decision === 'approve' || confirmTarget.decision === 'reinstate' ? 'default' : 'danger'}
          onConfirm={() => review(confirmTarget.app.id, confirmTarget.decision)}
          onClose={() => setConfirmTarget(null)}
        />
      )}

      {rejectTarget && (
        <PromptDialog
          open
          title="Reject provider application"
          message={`Explain why ${rejectTarget.full_name}'s application is being rejected. This reason is sent to them.`}
          placeholder="e.g. Evidence of ownership could not be verified."
          confirmLabel="Reject application"
          onSubmit={(reason) => {
            if (reason.trim().length < 3) {
              toast('A rejection reason of at least 3 characters is required.', 'error');
              return Promise.resolve();
            }
            return review(rejectTarget.id, 'reject', reason.trim());
          }}
          onClose={() => setRejectTarget(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Advert moderation                                                          */
/* -------------------------------------------------------------------------- */

const ADVERT_STATUS_ORDER: Array<ModerationStatus | 'all'> = [
  'all',
  'pending_review',
  'approved',
  'rejected',
  'rented',
  'removed',
  'submitted'
];

function AdvertsPanel() {
  const { toast } = useToast();
  const [adverts, setAdverts] = useState<AdminAdvert[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<ModerationStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<AdminAdvert | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminAdvert | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListAdverts(filter === 'all' ? null : filter, 100, 0);
      setAdverts(res.adverts);
      setTotal(res.total);
    } catch (err: any) {
      toast(err?.message || 'Failed to load adverts.', 'error');
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const review = async (ad: AdminAdvert, decision: 'approve' | 'reject', note?: string) => {
    setBusyId(ad.id);
    try {
      const res = await adminReviewAdvert(ad.id, decision, note);
      toast(
        decision === 'approve'
          ? `Approved. Fee of ${koboToNaira(res.fee_kobo)} captured.`
          : `Rejected. Fee of ${koboToNaira(res.fee_kobo)} refunded.`,
        'success'
      );
      setApproveTarget(null);
      setRejectTarget(null);
      await load();
    } catch (err: any) {
      toast(err?.message || 'Action failed.', 'error');
      if (decision === 'reject') setRejectTarget(null);
    } finally {
      setBusyId(null);
    }
  };

  const statusMeta: Record<string, { bg: string; fg: string; label: string }> = {
    draft: { bg: 'var(--surface-alt)', fg: 'var(--text-secondary)', label: 'Draft' },
    submitted: { bg: 'var(--surface-alt)', fg: 'var(--text-secondary)', label: 'Submitted' },
    pending_review: { bg: 'var(--warning-bg)', fg: 'var(--amber-700)', label: 'Pending review' },
    approved: { bg: 'var(--success-bg)', fg: '#047857', label: 'Approved / live' },
    rejected: { bg: 'var(--error-bg)', fg: 'var(--red-700)', label: 'Rejected' },
    rented: { bg: 'var(--error-bg)', fg: 'var(--red-700)', label: 'Rented' },
    removed: { bg: 'var(--surface-alt)', fg: 'var(--text-secondary)', label: 'Removed' }
  };

  const feeStatusLabel: Record<string, string> = {
    unpaid: 'No payment',
    reserved: 'Fee reserved (pending)',
    captured: 'Fee captured',
    refunded: 'Fee refunded',
    failed: 'Payment failed'
  };

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        {ADVERT_STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className="btn btn-secondary"
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: filter === s ? 800 : 600,
              background: filter === s ? 'var(--primary)' : undefined,
              color: filter === s ? '#fff' : undefined
            }}
          >
            {s === 'all' ? 'All adverts' : statusMeta[s].label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)', alignSelf: 'center' }}>
          {total} total
        </span>
      </div>

      {loading ? (
        <div className="empty-state" style={{ padding: 48, textAlign: 'center' }}>
          <span className="route-fallback-spinner" />
          <p>Loading advertised listings...</p>
        </div>
      ) : adverts.length === 0 ? (
        <div className="empty-state" style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <CheckCircle size={36} color="var(--muted)" style={{ marginBottom: 12 }} />
          <h3>No adverts in this queue</h3>
          <p>Listings appear here once a provider submits them for review with a reserved fee.</p>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface-alt)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '12px 16px' }}>Listing</th>
              <th style={{ padding: '12px 16px' }}>Provider</th>
              <th style={{ padding: '12px 16px' }}>Rent</th>
              <th style={{ padding: '12px 16px' }}>Fee</th>
              <th style={{ padding: '12px 16px' }}>Status</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {adverts.map((ad) => {
              const meta = statusMeta[ad.moderation_status];
              const pending = ad.moderation_status === 'pending_review' || ad.moderation_status === 'submitted';
              return (
                <tr key={ad.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontWeight: 700 }}>{ad.title}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                      {ad.rent_period} · item {ad.slug}
                    </div>
                    {ad.moderation_note && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Note: {ad.moderation_note}
                      </div>
                    )}
                    {ad.payment_status === 'refunded' && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Refunded {ad.refunded_at ? new Date(ad.refunded_at).toLocaleString() : ''}
                      </div>
                    )}
                    {ad.payment_status === 'captured' && (
                      <div style={{ fontSize: 12, color: '#047857', marginTop: 2 }}>
                        Captured {ad.captured_at ? new Date(ad.captured_at).toLocaleString() : ''}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div>{ad.provider_name || 'Unknown provider'}</div>
                    <span className="pill-badge" style={{ fontSize: 11 }}>
                      {ad.provider_type === 'landlord' ? 'Landlord' : ad.provider_type === 'caretaker' ? 'Caretaker' : '—'}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontWeight: 700 }}>{koboToNaira(ad.advert_rent_kobo)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      Annual: {koboToNaira(ad.annual_rent_kobo)} · {ad.rent_period}
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                      <Wallet size={13} /> {koboToNaira(ad.fee_kobo)}
                    </div>
                    {ad.fee_bps != null && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{(ad.fee_bps / 100).toFixed(1)}%</div>
                    )}
                    <span
                      className="badge"
                      style={{
                        background: ad.payment_status === 'captured' ? 'var(--success-bg)' : 'var(--surface-alt)',
                        color: ad.payment_status === 'captured' ? '#047857' : 'var(--text-secondary)',
                        fontWeight: 700,
                        marginTop: 4
                      }}
                    >
                      {feeStatusLabel[ad.payment_status ?? 'unpaid'] ?? ad.payment_status}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span className="badge" style={{ background: meta.bg, color: meta.fg, fontWeight: 700 }}>
                      {meta.label}
                    </span>
                    {ad.submitted_at && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Submitted {new Date(ad.submitted_at).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      {pending ? (
                        <>
                          <button
                            type="button"
                            disabled={busyId === ad.id}
                            onClick={() => setApproveTarget(ad)}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 11, color: '#047857' }}
                          >
                            <BadgeCheck size={14} /> Approve
                          </button>
                          <button
                            type="button"
                            disabled={busyId === ad.id}
                            onClick={() => setRejectTarget(ad)}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 11, color: 'var(--red-700)' }}
                          >
                            <XCircle size={14} /> Reject
                          </button>
                        </>
                      ) : (
                        <a
                          href={`/accommodation/${ad.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                          style={{ padding: 6 }}
                          title="View public page"
                        >
                          <Eye size={14} />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {approveTarget && (
        <ConfirmDialog
          open
          title="Approve advertisement?"
          message={`Approve "${approveTarget.title}"? The reserved fee of ${koboToNaira(approveTarget.fee_kobo)} will be captured from the provider's wallet and the listing goes live.`}
          confirmLabel="Approve & capture fee"
          tone="default"
          onConfirm={() => review(approveTarget, 'approve')}
          onClose={() => setApproveTarget(null)}
        />
      )}

      {rejectTarget && (
        <PromptDialog
          open
          title="Reject advertisement"
          message={`Reject "${rejectTarget.title}"? The reserved fee of ${koboToNaira(rejectTarget.fee_kobo)} will be released back to the provider. State a reason they will see.`}
          placeholder="e.g. The listed amenities do not match the uploaded photos."
          confirmLabel="Reject & refund fee"
          onSubmit={(reason) => {
            if (reason.trim().length < 3) {
              toast('A rejection reason of at least 3 characters is required.', 'error');
              return Promise.resolve();
            }
            return review(rejectTarget, 'reject', reason.trim());
          }}
          onClose={() => setRejectTarget(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Advert fee settings                                                        */
/* -------------------------------------------------------------------------- */

const FEE_EXAMPLE_ANNUAL_NAIRA = [100000, 150000, 300000, 500000, 1000000];

function AdvertSettingsPanel() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AdvertSettings | null>(null);
  const [feeBps, setFeeBps] = useState(150);
  const [enabled, setEnabled] = useState(true);
  const [currency, setCurrency] = useState('NGN');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchAdvertSettings();
      setSettings(s);
      setFeeBps(s.fee_bps);
      setEnabled(s.enabled);
      setCurrency(s.currency);
    } catch (err: any) {
      toast(err?.message || 'Failed to load advert fee settings.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await adminUpdateAdvertSettings({ feeBps, enabled, currency });
      setSettings(updated);
      toast('Advertisement fee settings saved.', 'success');
    } catch (err: any) {
      toast(err?.message || 'Failed to save advert fee settings.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <SettingsIcon size={18} color="var(--primary)" />
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Advertisement fee settings</h3>
        </div>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--text-secondary)' }}>
          Providers reserve this fee per listing and it is captured on approval or released on rejection.
        </p>

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <span className="route-fallback-spinner" />
          </div>
        ) : (
          <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                Fee percentage (basis points)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="number"
                  min={0}
                  max={5000}
                  step={1}
                  value={feeBps}
                  onChange={(e) => setFeeBps(Number(e.target.value))}
                  className="form-input"
                  style={{ width: 140 }}
                />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  = {(feeBps / 100).toFixed(2)}% of annual rent
                </span>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Currency</label>
              <input
                type="text"
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="form-input"
                style={{ width: 140 }}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>
                <strong>Enabled</strong> — new submissions require a reserved fee
              </span>
            </label>

            <button type="submit" disabled={busy} className="btn btn-primary" style={{ justifyContent: 'center' }}>
              {busy ? 'Saving...' : 'Save settings'}
            </button>
          </form>
        )}
      </div>

      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Wallet size={18} color="var(--primary)" />
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>What providers will pay</h3>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text-secondary)' }}>
          Example advertisement fees at the current {enabled ? 'enabled' : 'disabled'} rate of {(feeBps / 100).toFixed(2)}%.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px 4px', textAlign: 'left' }}>Annual rent</th>
              <th style={{ padding: '8px 4px', textAlign: 'right' }}>Fee</th>
            </tr>
          </thead>
          <tbody>
            {FEE_EXAMPLE_ANNUAL_NAIRA.map((annualNaira) => {
              const fee = Math.round((annualNaira * 100 * feeBps) / 10000 / 100) * 100;
              return (
                <tr key={annualNaira} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 4px' }}>{formatNaira(annualNaira)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700, color: 'var(--green-800)' }}>
                    {formatNaira(fee / 100)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!enabled && (
          <p style={{ fontSize: 12, color: 'var(--amber-700)', marginTop: 12 }}>
            Fee collection is disabled: listings can still be submitted but no fee is reserved or charged.
          </p>
        )}
        {settings && (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 12 }}>
            Saved: {(settings.fee_bps / 100).toFixed(2)}% · {settings.currency} · {settings.enabled ? 'enabled' : 'disabled'}
          </p>
        )}
      </div>
    </div>
  );
}
