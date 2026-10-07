import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Users,
  Search,
  Filter,
  Phone,
  MessageCircle,
  PlusCircle,
  CheckCircle2,
  Calendar,
  MapPin,
  Home,
  ArrowLeft,
  Share2,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  X,
  Loader2,
  AlertCircle,
  Clock,
  Eye,
  Trash2,
  Edit3,
  Check,
  HeartHandshake,
  UserCheck
} from 'lucide-react';
import { Logo } from '../components/Logo';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../lib/AuthContext';
import {
  type RoommateRequest,
  type RoommateFilterOptions,
  ACCOMMODATION_LOCATIONS,
  ROOMMATE_ACCOMMODATION_TYPES,
  fetchRoommateRequests,
  fetchMyRoommateRequests,
  publishRoommateRequest,
  setRoommateRequestStatus,
  deleteRoommateRequest,
  recordRoommateView,
  formatPhoneNumberForCall,
  formatWhatsAppUrl,
  formatNaira
} from '../lib/accommodation';
import { useToast } from '../components/Toast';

export const RoommateFinderPage: React.FC = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab: 'all' | 'mine'
  const [activeTab, setActiveTab] = useState<'all' | 'mine'>('all');

  // Listings data
  const [requests, setRequests] = useState<RoommateRequest[]>([]);
  const [myRequests, setMyRequests] = useState<RoommateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [genderFilter, setGenderFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [locationFilter, setLocationFilter] = useState<string>('All Locations');
  const [maxBudgetFilter, setMaxBudgetFilter] = useState<string>('');

  // Selected request for details modal
  const [selectedRequest, setSelectedRequest] = useState<RoommateRequest | null>(null);

  // Delete confirmation dialog state (no browser popups)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Post / Edit Request Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<RoommateRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form fields
  const [targetGender, setTargetGender] = useState<'Male' | 'Female' | 'Any'>('Any');
  const [budgetMin, setBudgetMin] = useState<string>('50000');
  const [budgetMax, setBudgetMax] = useState<string>('120000');
  const [accommodationType, setAccommodationType] = useState<string>('Shared Lodge');
  const [preferredLocation, setPreferredLocation] = useState<string>('Campus Environs');
  const [description, setDescription] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [whatsappNumber, setWhatsappNumber] = useState<string>('');

  // Auto-fill user defaults when opening modal
  useEffect(() => {
    if (profile && !editingRequest) {
      if (profile.phoneNumber) {
        setPhoneNumber(profile.phoneNumber);
        setWhatsappNumber(profile.phoneNumber);
      }
    }
  }, [profile, editingRequest]);

  // Load all requests
  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
      const filters: RoommateFilterOptions = {
        gender: genderFilter !== 'All' ? genderFilter : undefined,
        location: locationFilter !== 'All Locations' ? locationFilter : undefined,
        accommodationType: typeFilter !== 'All' ? typeFilter : undefined,
        maxBudget: maxBudgetFilter ? Number(maxBudgetFilter) : undefined,
        query: searchQuery.trim() || undefined,
      };
      const data = await fetchRoommateRequests(filters);
      setRequests(data);

      if (user) {
        const mine = await fetchMyRoommateRequests();
        setMyRequests(mine);
      }
    } catch (err: any) {
      toast(err?.message || 'Could not load roommate requests.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [genderFilter, locationFilter, typeFilter, maxBudgetFilter, searchQuery, user, toast]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // Deep-link requestId and create/post query detection
  useEffect(() => {
    const reqId = searchParams.get('requestId');
    if (reqId && requests.length > 0) {
      const target = requests.find((r) => r.id === reqId);
      if (target) {
        setSelectedRequest(target);
        recordRoommateView(target.id);
      }
    }
    if (searchParams.get('create') === '1' || searchParams.get('post') === '1' || searchParams.get('new') === '1') {
      if (!user) {
        toast('Please sign in with your student account to post a roommate request', 'info');
        navigate('/login', { state: { from: { pathname: '/accommodation/roommates', search: '?create=1' } } });
        return;
      }
      setIsModalOpen(true);
    }
  }, [searchParams, requests, user, navigate, toast]);

  const handleOpenCreateModal = () => {
    if (!user) {
      toast('Please sign in with your student account to post a roommate request', 'info');
      navigate('/login', { state: { from: { pathname: '/accommodation/roommates', search: '?create=1' } } });
      return;
    }
    setEditingRequest(null);
    setTargetGender('Any');
    setBudgetMin('50000');
    setBudgetMax('120000');
    setAccommodationType('Shared Lodge');
    setPreferredLocation('Campus Environs');
    setDescription('');
    if (profile?.phoneNumber) {
      setPhoneNumber(profile.phoneNumber);
      setWhatsappNumber(profile.phoneNumber);
    } else {
      setPhoneNumber('');
      setWhatsappNumber('');
    }
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (req: RoommateRequest) => {
    setEditingRequest(req);
    setTargetGender(req.target_gender);
    setBudgetMin(String(req.budget_min));
    setBudgetMax(String(req.budget_max));
    setAccommodationType(req.accommodation_type);
    setPreferredLocation(req.preferred_location);
    setDescription(req.description);
    setPhoneNumber(req.phone_number);
    setWhatsappNumber(req.whatsapp_number);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const minB = Number(budgetMin);
    const maxB = Number(budgetMax);

    if (isNaN(minB) || minB < 0) {
      setFormError('Please enter a valid minimum budget.');
      return;
    }
    if (isNaN(maxB) || maxB < minB) {
      setFormError('Maximum budget must be greater than or equal to minimum budget.');
      return;
    }
    if (description.trim().length < 15) {
      setFormError('Please enter a descriptive introduction (at least 15 characters).');
      return;
    }
    const cleanPhone = phoneNumber.replace(/[^0-9+]/g, '');
    const cleanWA = whatsappNumber.replace(/[^0-9+]/g, '');
    if (cleanPhone.length < 10) {
      setFormError('Please enter a valid phone number (at least 10 digits).');
      return;
    }
    if (cleanWA.length < 10) {
      setFormError('Please enter a valid WhatsApp number (at least 10 digits).');
      return;
    }

    try {
      setSubmitting(true);
      await publishRoommateRequest({
        id: editingRequest ? editingRequest.id : undefined,
        target_gender: targetGender,
        budget_min: minB,
        budget_max: maxB,
        accommodation_type: accommodationType,
        preferred_location: preferredLocation,
        description: description.trim(),
        phone_number: cleanPhone,
        whatsapp_number: cleanWA,
      });

      setIsModalOpen(false);
      toast(
        editingRequest
          ? 'Roommate request updated successfully!'
          : `Request published! Notified matching ${targetGender === 'Any' ? 'students' : targetGender.toLowerCase() + ' students'}.`,
        'success'
      );

      loadRequests();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to publish roommate request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (reqId: string, newStatus: 'active' | 'matched' | 'closed') => {
    try {
      await setRoommateRequestStatus(reqId, newStatus);
      toast(
        newStatus === 'matched' ? 'Marked as matched! Congratulations.' : `Status updated to ${newStatus}.`,
        'success'
      );
      loadRequests();
    } catch (err: any) {
      toast(err?.message || 'Failed to update status.', 'error');
    }
  };

  const handleDelete = (reqId: string) => {
    setDeleteConfirmId(reqId);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      setIsDeleting(true);
      await deleteRoommateRequest(deleteConfirmId);
      toast('Roommate request deleted successfully.', 'success');
      if (selectedRequest?.id === deleteConfirmId) setSelectedRequest(null);
      setDeleteConfirmId(null);
      loadRequests();
    } catch (err: any) {
      toast(err?.message || 'Failed to delete request.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const displayedList = activeTab === 'mine' ? myRequests : requests;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-alt, #f7faf8)', paddingBottom: 80 }}>
      {/* Top Banner Navigation */}
      <div style={{ background: 'var(--surface, #ffffff)', borderBottom: '1px solid var(--border, #dcebe0)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link
              to="/accommodation"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--primary, #12603d)',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: 14,
                padding: '6px 12px',
                borderRadius: 8,
                background: 'var(--primary-bg, #e8f5ec)',
              }}
            >
              <ArrowLeft size={16} />
              <span>Back to Lodges</span>
            </Link>
            <div style={{ height: 20, width: 1, background: 'var(--border, #dcebe0)' }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
              Accommodation &middot; <strong>Roommate Finder</strong>
            </span>
          </div>

          <button
            onClick={handleOpenCreateModal}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--primary, #12603d)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 10,
              padding: '10px 18px',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(18, 96, 61, 0.2)',
            }}
          >
            <PlusCircle size={18} />
            <span>Post Roommate Request</span>
          </button>
        </div>
      </div>

      {/* Hero Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0d4a2f 0%, #12603d 60%, #1b7a4c 100%)',
          color: '#ffffff',
          padding: '44px 20px',
          boxShadow: '0 4px 20px rgba(13, 74, 47, 0.15)',
        }}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(255, 255, 255, 0.15)',
              padding: '6px 14px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              color: '#a7f3d0',
              marginBottom: 14,
            }}
          >
            <Logo size={18} />
            <span>Official FUW Verified Student Accommodation Network</span>
          </div>

          <h1
            style={{
              fontSize: 'clamp(26px, 4.5vw, 40px)',
              fontWeight: 800,
              margin: '0 0 12px',
              fontFamily: 'var(--font-serif, Georgia, serif)',
              letterSpacing: '-0.01em',
            }}
          >
            Find a Roommate in Wukari
          </h1>

          <p
            style={{
              fontSize: 'clamp(14px, 2.5vw, 17px)',
              color: '#d1fae5',
              maxWidth: 720,
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            Split lodge rent, discover trusted course mates, and find compatible roommates across
            New Site, Old Site, Hospital Road, and campus environs safely.
          </p>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
        {/* Navigation Tabs & Metrics */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border, #dcebe0)',
            paddingBottom: 12,
            marginBottom: 20,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setActiveTab('all')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: activeTab === 'all' ? 'var(--primary, #12603d)' : 'transparent',
                color: activeTab === 'all' ? '#ffffff' : 'var(--text-secondary, #55675b)',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              <Users size={16} />
              <span>All Requests</span>
              <span
                style={{
                  background: activeTab === 'all' ? 'rgba(255,255,255,0.2)' : 'var(--border, #dcebe0)',
                  color: activeTab === 'all' ? '#ffffff' : 'var(--text-primary, #17231d)',
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontSize: 12,
                }}
              >
                {requests.length}
              </span>
            </button>

            {user && (
              <button
                onClick={() => setActiveTab('mine')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: activeTab === 'mine' ? 'var(--primary, #12603d)' : 'transparent',
                  color: activeTab === 'mine' ? '#ffffff' : 'var(--text-secondary, #55675b)',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                <HeartHandshake size={16} />
                <span>My Requests</span>
                <span
                  style={{
                    background: activeTab === 'mine' ? 'rgba(255,255,255,0.2)' : 'var(--border, #dcebe0)',
                    color: activeTab === 'mine' ? '#ffffff' : 'var(--text-primary, #17231d)',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                >
                  {myRequests.length}
                </span>
              </button>
            )}
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={14} color="var(--primary, #12603d)" />
            <span>Direct phone & WhatsApp contact with verified students</span>
          </div>
        </div>

        {/* Filter Surface (Only in 'all' tab) */}
        {activeTab === 'all' && (
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              border: '1px solid var(--border, #dcebe0)',
              borderRadius: 14,
              padding: '16px 20px',
              marginBottom: 24,
              boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(18, 96, 61, 0.04))',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, alignItems: 'center' }}>
              {/* Search */}
              <div style={{ position: 'relative' }}>
                <Search size={16} color="var(--text-secondary, #55675b)" style={{ position: 'absolute', left: 12, top: 12 }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name, course, area..."
                  style={{
                    width: '100%',
                    padding: '9px 12px 9px 36px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #dcebe0)',
                    fontSize: 13,
                    background: 'var(--surface-alt, #f7faf8)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Gender Preference */}
              <div>
                <select
                  value={genderFilter}
                  onChange={(e) => setGenderFilter(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #dcebe0)',
                    fontSize: 13,
                    background: 'var(--surface-alt, #f7faf8)',
                  }}
                >
                  <option value="All">All Roommate Genders</option>
                  <option value="Male">Seeking Male Roommates</option>
                  <option value="Female">Seeking Female Roommates</option>
                  <option value="Any">Flexible / Any Gender</option>
                </select>
              </div>

              {/* Lodge Type */}
              <div>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #dcebe0)',
                    fontSize: 13,
                    background: 'var(--surface-alt, #f7faf8)',
                  }}
                >
                  <option value="All">All Lodge Types</option>
                  {ROOMMATE_ACCOMMODATION_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Location Area */}
              <div>
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #dcebe0)',
                    fontSize: 13,
                    background: 'var(--surface-alt, #f7faf8)',
                  }}
                >
                  {ACCOMMODATION_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              {/* Max Budget */}
              <div>
                <input
                  type="number"
                  value={maxBudgetFilter}
                  onChange={(e) => setMaxBudgetFilter(e.target.value)}
                  placeholder="Max Budget (₦)..."
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #dcebe0)',
                    fontSize: 13,
                    background: 'var(--surface-alt, #f7faf8)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {/* Active filters reset */}
            {(genderFilter !== 'All' || typeFilter !== 'All' || locationFilter !== 'All Locations' || maxBudgetFilter || searchQuery) && (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>Active filters applied:</span>
                <button
                  onClick={() => {
                    setGenderFilter('All');
                    setTypeFilter('All');
                    setLocationFilter('All Locations');
                    setMaxBudgetFilter('');
                    setSearchQuery('');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#b91c1c',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <X size={14} />
                  <span>Reset All Filters</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Requests List */}
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 20 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: 240,
                  borderRadius: 14,
                  background: 'var(--surface, #ffffff)',
                  border: '1px solid var(--border, #dcebe0)',
                  animation: 'pulse 1.5s infinite',
                }}
              />
            ))}
          </div>
        ) : displayedList.length === 0 ? (
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 14,
              border: '1px solid var(--border, #dcebe0)',
              padding: '48px 24px',
              textAlign: 'center',
            }}
          >
            <Users size={48} color="var(--primary, #12603d)" style={{ margin: '0 auto 16px', opacity: 0.6 }} />
            <h3 style={{ margin: '0 0 8px', fontSize: 18, color: 'var(--text-primary, #17231d)' }}>
              {activeTab === 'mine' ? 'No Roommate Requests Posted Yet' : 'No Matching Roommate Requests'}
            </h3>
            <p style={{ margin: '0 0 20px', color: 'var(--text-secondary, #55675b)', fontSize: 14, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>
              {activeTab === 'mine'
                ? 'Create a roommate request to broadcast your accommodation budget and preferences to other verified students.'
                : 'Try adjusting your gender preference, budget, or lodge type filters to discover more students.'}
            </p>
            <button
              onClick={handleOpenCreateModal}
              style={{
                background: 'var(--primary, #12603d)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 20px',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Post a Request Now
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 20 }}>
            {displayedList.map((req) => {
              const isOwner = user?.id === req.student_id;
              const callLink = `tel:${formatPhoneNumberForCall(req.phone_number)}`;
              const waLink = formatWhatsAppUrl(
                req.whatsapp_number,
                `Hello ${req.student_name || 'colleague'}, I saw your roommate request on FUW Campus Hub Accommodation for ${req.preferred_location} and would like to connect!`
              );

              return (
                <div
                  key={req.id}
                  style={{
                    background: 'var(--surface, #ffffff)',
                    border: '1px solid var(--border, #dcebe0)',
                    borderRadius: 14,
                    padding: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: 'var(--shadow-sm, 0 2px 6px rgba(18, 96, 61, 0.05))',
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  }}
                >
                  <div>
                    {/* Header: Student Info + Status */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: '50%',
                            background: 'var(--primary-bg, #e8f5ec)',
                            color: 'var(--primary, #12603d)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 16,
                            fontWeight: 800,
                            overflow: 'hidden',
                          }}
                        >
                          {req.student_avatar ? (
                            <img src={req.student_avatar} alt={req.student_name || 'Student'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            (req.student_name || 'S').charAt(0).toUpperCase()
                          )}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <strong style={{ fontSize: 15, color: 'var(--text-primary, #17231d)' }}>
                              {req.student_name || 'FUW Student'}
                            </strong>
                            {req.student_verified && (
                              <span title="Verified FUW Student" style={{ display: 'inline-flex' }}>
                                <CheckCircle2 size={15} color="#15803d" />
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                            {req.student_department ? `${req.student_department} ${req.student_level ? `(${req.student_level}L)` : ''}` : 'FUW Student'}
                          </span>
                        </div>
                      </div>

                      {/* Status badge */}
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '4px 8px',
                          borderRadius: 12,
                          background:
                            req.status === 'active'
                              ? 'var(--primary-bg, #e8f5ec)'
                              : req.status === 'matched'
                              ? '#fef3c7'
                              : '#f3f4f6',
                          color:
                            req.status === 'active'
                              ? 'var(--primary, #12603d)'
                              : req.status === 'matched'
                              ? '#b45309'
                              : '#6b7280',
                          textTransform: 'uppercase',
                        }}
                      >
                        {req.status === 'matched' ? 'Roommate Found' : req.status}
                      </span>
                    </div>

                    {/* Target Gender & Budget Pill */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '4px 9px',
                          borderRadius: 8,
                          background:
                            req.target_gender === 'Female'
                              ? '#fce7f3'
                              : req.target_gender === 'Male'
                              ? '#e0f2fe'
                              : '#f3f4f6',
                          color:
                            req.target_gender === 'Female'
                              ? '#9d174d'
                              : req.target_gender === 'Male'
                              ? '#0369a1'
                              : '#374151',
                        }}
                      >
                        <UserCheck size={13} />
                        Looking for: <strong>{req.target_gender}</strong>
                      </span>

                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          padding: '4px 9px',
                          borderRadius: 8,
                          background: 'var(--primary-bg, #e8f5ec)',
                          color: 'var(--primary, #12603d)',
                        }}
                      >
                        Budget: <strong>{formatNaira(req.budget_min)} to {formatNaira(req.budget_max)}</strong>
                      </span>
                    </div>

                    {/* Lodge type & Location */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Home size={15} color="var(--primary, #12603d)" style={{ flexShrink: 0 }} />
                        <span>Room Type: <strong style={{ color: 'var(--text-primary, #17231d)' }}>{req.accommodation_type}</strong></span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MapPin size={15} color="#b91c1c" style={{ flexShrink: 0 }} />
                        <span>Location: <strong style={{ color: 'var(--text-primary, #17231d)' }}>{req.preferred_location}</strong></span>
                      </div>
                    </div>

                    {/* Bio Description */}
                    <p
                      style={{
                        margin: '0 0 16px',
                        fontSize: 13.5,
                        color: 'var(--text-primary, #17231d)',
                        lineHeight: 1.5,
                        background: 'var(--surface-alt, #f7faf8)',
                        padding: 10,
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        wordBreak: 'break-word',
                      }}
                    >
                      {req.description}
                    </p>
                  </div>

                  {/* Actions Bar */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={13} />
                        {new Date(req.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Eye size={13} />
                        {req.view_count} views
                      </span>
                    </div>

                    {isOwner ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => handleOpenEditModal(req)}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            padding: '8px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--border, #dcebe0)',
                            background: 'var(--surface, #ffffff)',
                            color: 'var(--text-primary, #17231d)',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <Edit3 size={15} />
                          <span>Edit</span>
                        </button>

                        <button
                          onClick={() => handleStatusChange(req.id, req.status === 'matched' ? 'active' : 'matched')}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            padding: '8px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--primary, #12603d)',
                            background: req.status === 'matched' ? 'var(--surface, #ffffff)' : 'var(--primary-bg, #e8f5ec)',
                            color: 'var(--primary, #12603d)',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <Check size={15} />
                          <span>{req.status === 'matched' ? 'Reopen' : 'Matched'}</span>
                        </button>

                        <button
                          onClick={() => handleDelete(req.id)}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: '1px solid #fee2e2',
                            background: '#fef2f2',
                            color: '#b91c1c',
                            cursor: 'pointer',
                          }}
                          title="Delete Request"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8 }}>
                        {/* Call */}
                        <a
                          href={callLink}
                          onClick={() => recordRoommateView(req.id)}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            padding: '9px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--primary, #12603d)',
                            background: 'transparent',
                            color: 'var(--primary, #12603d)',
                            textDecoration: 'none',
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          <Phone size={15} />
                          <span>Call</span>
                        </a>

                        {/* WhatsApp */}
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => recordRoommateView(req.id)}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            padding: '9px 12px',
                            borderRadius: 8,
                            background: '#25D366',
                            color: '#ffffff',
                            textDecoration: 'none',
                            fontSize: 13,
                            fontWeight: 700,
                            border: 'none',
                          }}
                        >
                          <MessageCircle size={15} />
                          <span>WhatsApp</span>
                        </a>

                        {/* View Details modal */}
                        <button
                          onClick={() => {
                            setSelectedRequest(req);
                            recordRoommateView(req.id);
                          }}
                          style={{
                            padding: '9px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--border, #dcebe0)',
                            background: 'var(--surface-alt, #f7faf8)',
                            color: 'var(--text-secondary, #55675b)',
                            cursor: 'pointer',
                          }}
                          title="View Details"
                        >
                          <Eye size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Details Modal */}
      {selectedRequest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setSelectedRequest(null)}
        >
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              maxWidth: 520,
              width: '100%',
              padding: 24,
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              position: 'relative',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedRequest(null)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary, #55675b)',
              }}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: 'var(--primary-bg, #e8f5ec)',
                  color: 'var(--primary, #12603d)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  fontWeight: 800,
                }}
              >
                {(selectedRequest.student_name || 'S').charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 18, color: 'var(--text-primary, #17231d)' }}>
                  {selectedRequest.student_name || 'FUW Student'}
                </h3>
                <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                  {selectedRequest.student_department ? `${selectedRequest.student_department} ${selectedRequest.student_level ? `(${selectedRequest.student_level}L)` : ''}` : 'Federal University Wukari'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ padding: '4px 10px', borderRadius: 8, background: 'var(--primary-bg, #e8f5ec)', color: 'var(--primary, #12603d)', fontSize: 12, fontWeight: 700 }}>
                Looking for: {selectedRequest.target_gender} Roommate
              </span>
              <span style={{ padding: '4px 10px', borderRadius: 8, background: '#fef3c7', color: '#b45309', fontSize: 12, fontWeight: 700 }}>
                Budget: {formatNaira(selectedRequest.budget_min)} to {formatNaira(selectedRequest.budget_max)}
              </span>
            </div>

            <div style={{ marginBottom: 16, fontSize: 14, color: 'var(--text-secondary, #55675b)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div><strong>Room Preference:</strong> {selectedRequest.accommodation_type}</div>
              <div><strong>Target Location:</strong> {selectedRequest.preferred_location}</div>
              <div><strong>Status:</strong> <span style={{ textTransform: 'capitalize' }}>{selectedRequest.status}</span></div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Introduction & Accommodation Notes</h4>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, background: 'var(--surface-alt, #f7faf8)', padding: 12, borderRadius: 8, border: '1px solid var(--border, #dcebe0)' }}>
                {selectedRequest.description}
              </p>
            </div>

            {/* Direct contact affordances */}
            <div style={{ display: 'flex', gap: 10 }}>
              <a
                href={`tel:${formatPhoneNumberForCall(selectedRequest.phone_number)}`}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '11px',
                  borderRadius: 10,
                  border: '1px solid var(--primary, #12603d)',
                  color: 'var(--primary, #12603d)',
                  textDecoration: 'none',
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                <Phone size={16} />
                <span>Call ({selectedRequest.phone_number})</span>
              </a>

              <a
                href={formatWhatsAppUrl(
                  selectedRequest.whatsapp_number,
                  `Hello ${selectedRequest.student_name || 'colleague'}, I saw your roommate request on FUW Accommodation and would like to connect!`
                )}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '11px',
                  borderRadius: 10,
                  background: '#25D366',
                  color: '#ffffff',
                  textDecoration: 'none',
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                <MessageCircle size={16} />
                <span>WhatsApp</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Post / Edit Request Modal */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !submitting && setIsModalOpen(false)}
        >
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              maxWidth: 580,
              width: '100%',
              padding: '24px 20px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              position: 'relative',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 18, color: 'var(--text-primary, #17231d)' }}>
                  {editingRequest ? 'Edit Roommate Request' : 'Create Roommate Request'}
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                  Published requests will notify students matching your preferred gender.
                </p>
              </div>
              <button
                onClick={() => !submitting && setIsModalOpen(false)}
                disabled={submitting}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-secondary, #55675b)',
                  padding: 8,
                  minWidth: 36,
                  minHeight: 36,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fee2e2',
                  borderRadius: 8,
                  padding: '10px 14px',
                  color: '#b91c1c',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <AlertCircle size={16} />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitRequest} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Gender Preference */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  Who are you looking to share a room with? (Target Gender)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                  {(['Male', 'Female', 'Any'] as const).map((g) => (
                    <button
                      type="button"
                      key={g}
                      onClick={() => setTargetGender(g)}
                      style={{
                        padding: '10px 14px',
                        minHeight: 44,
                        borderRadius: 8,
                        border: targetGender === g ? '2px solid var(--primary, #12603d)' : '1px solid var(--border, #dcebe0)',
                        background: targetGender === g ? 'var(--primary-bg, #e8f5ec)' : 'var(--surface, #ffffff)',
                        color: targetGender === g ? 'var(--primary, #12603d)' : 'var(--text-primary, #17231d)',
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      {g === 'Any' ? 'Any / Flexible' : `${g} Roommate`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Budget Min & Max */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Min Budget (₦)
                  </label>
                  <input
                    type="number"
                    value={budgetMin}
                    onChange={(e) => setBudgetMin(e.target.value)}
                    required
                    min="0"
                    step="5000"
                    placeholder="e.g. 50000"
                    style={{
                      width: '100%',
                      minHeight: 44,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      fontSize: 14,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Max Budget (₦)
                  </label>
                  <input
                    type="number"
                    value={budgetMax}
                    onChange={(e) => setBudgetMax(e.target.value)}
                    required
                    min="0"
                    step="5000"
                    placeholder="e.g. 120000"
                    style={{
                      width: '100%',
                      minHeight: 44,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      fontSize: 14,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Room type & Preferred area */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Accommodation Type
                  </label>
                  <select
                    value={accommodationType}
                    onChange={(e) => setAccommodationType(e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: 44,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      fontSize: 14,
                      boxSizing: 'border-box',
                      background: 'var(--surface, #ffffff)',
                      color: 'var(--text-primary, #17231d)',
                    }}
                  >
                    {ROOMMATE_ACCOMMODATION_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Preferred Location / Area
                  </label>
                  <select
                    value={preferredLocation}
                    onChange={(e) => setPreferredLocation(e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: 44,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      fontSize: 14,
                      boxSizing: 'border-box',
                      background: 'var(--surface, #ffffff)',
                      color: 'var(--text-primary, #17231d)',
                    }}
                  >
                    {ACCOMMODATION_LOCATIONS.filter((l) => l !== 'All Locations').map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Contact Numbers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    Call Phone Number
                  </label>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    required
                    placeholder="08012345678"
                    style={{
                      width: '100%',
                      minHeight: 44,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      fontSize: 14,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    WhatsApp Number
                  </label>
                  <input
                    type="tel"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    required
                    placeholder="08012345678"
                    style={{
                      width: '100%',
                      minHeight: 44,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      fontSize: 14,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Bio / Description */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  About You & Desired Lodge Setup
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  rows={4}
                  placeholder="Tell potential roommates about your study routine, preferred lodge conditions, course of study, cleanliness habits, etc."
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #dcebe0)',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Submit Button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submitting}
                  style={{
                    minHeight: 44,
                    padding: '10px 18px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #dcebe0)',
                    background: 'var(--surface, #ffffff)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    minHeight: 44,
                    padding: '10px 22px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'var(--primary, #12603d)',
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  <span>{editingRequest ? 'Update Request' : 'Publish & Notify Matching Students'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Native popup replacement) */}
      <ConfirmDialog
        open={!!deleteConfirmId}
        title="Delete Roommate Request"
        message="Are you sure you want to delete this roommate request? This action cannot be undone."
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete Request'}
        tone="danger"
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteConfirmId(null)}
      />
    </div>
  );
};

export default RoommateFinderPage;
