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
  Loader2
} from 'lucide-react';
import { requireSupabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  AccommodationProperty,
  ACCOMMODATION_LOCATIONS,
  PROPERTY_TYPES,
  POPULAR_AMENITIES,
  formatNaira,
  getPropertyTypeLabel
} from '../lib/accommodation';
import { fx } from '../lib/motion';

export function AdminAccommodationTab() {
  const supabase = requireSupabase();
  const { toast } = useToast();
  const [properties, setProperties] = useState<AccommodationProperty[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'listings' | 'reports'>('listings');
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
      </div>

      {activeSubTab === 'listings' ? (
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
      ) : (
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
