import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarDays, Check, ExternalLink, Flag, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from './ConfirmDialog';
import { FileUploader, MediaThumbnail } from './FileUploader';
import {
  addTrackedCourse,
  cancelEventRsvp,
  CampusCourse,
  CampusListingModule,
  CampusRow,
  createCampusListing,
  deleteCampusListing,
  createLostFoundClaim,
  fetchCampusListings,
  fetchCourseCatalogue,
  fetchMyRsvps,
  fetchTrackedCourses,
  joinStudyGroup,
  removeTrackedCourse,
  reportCampusListing,
  requestOrganizationMembership,
  rsvpToEvent,
  TrackedCourse,
  updateTrackedCourse
} from '../lib/campus';
import { removeCampusMedia, type CampusMediaScope } from '../lib/campusMedia';
import {
  AcademicsReminderHint,
  AssignmentsPanel,
  CalendarPanel,
  CourseWorkspace,
  GradesPanel,
  TimetablePanel
} from './AcademicsWorkspace';
import { useToast } from './Toast';
import { useAuth } from '../lib/AuthContext';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not complete that request.';
}

type AcademicsView =
  | 'tracker'
  | 'workspace'
  | 'assignments'
  | 'timetable'
  | 'calendar'
  | 'grades';

const ACADEMICS_VIEWS: { key: AcademicsView; label: string }[] = [
  { key: 'tracker', label: 'Course tracker' },
  { key: 'workspace', label: 'Course workspace' },
  { key: 'assignments', label: 'Assignments' },
  { key: 'timetable', label: 'Timetable & exams' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'grades', label: 'Grades & GPA' }
];

export function CampusAcademicsModule({ department }: { department: string }) {
  const { toast } = useToast();
  const [catalogue, setCatalogue] = useState<CampusCourse[]>([]);
  const [courses, setCourses] = useState<TrackedCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCourse, setSavingCourse] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [view, setView] = useState<AcademicsView>('tracker');

  const load = useCallback(async () => {
    if (!department) {
      setCatalogue([]);
      setCourses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [available, tracked] = await Promise.all([
        fetchCourseCatalogue(department),
        fetchTrackedCourses()
      ]);
      setCatalogue(available);
      setCourses(tracked);
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [department]);

  useEffect(() => { void load(); }, [load]);

  const trackedIds = useMemo(() => new Set(courses.map((course) => course.id)), [courses]);
  const availableCourses = catalogue.filter((course) =>
    !trackedIds.has(course.id) &&
    `${course.code} ${course.title}`.toLowerCase().includes(search.trim().toLowerCase())
  );
  const totalUnits = courses
    .filter((course) => course.status !== 'withdrawn')
    .reduce((total, course) => total + (course.units ?? 0), 0);

  const addCourse = async (course: CampusCourse) => {
    setSavingCourse(course.id);
    try {
      await addTrackedCourse(course.id);
      toast(`${course.code} added to your course tracker.`, 'success');
      await load();
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setSavingCourse('');
    }
  };

  const changeStatus = async (course: TrackedCourse, status: TrackedCourse['status']) => {
    try {
      await updateTrackedCourse(course.trackerId, status);
      setCourses((current) => current.map((item) =>
        item.trackerId === course.trackerId ? { ...item, status } : item
      ));
    } catch (cause) {
      toast(errorText(cause), 'error');
    }
  };

  const removeCourse = async (course: TrackedCourse) => {
    try {
      await removeTrackedCourse(course.trackerId);
      setCourses((current) => current.filter((item) => item.trackerId !== course.trackerId));
      toast(`${course.code} removed from your tracker.`, 'info');
    } catch (cause) {
      toast(errorText(cause), 'error');
    }
  };

  return (
    <div className="portal-view-fade platform-shell">
      <header className="platform-header">
        <div>
          <p className="kicker">ACADEMICS · STUDENT-MAINTAINED</p>
          <h2>Academic companion</h2>
          <p className="subtitle">Track your courses against the official FUW catalogue. This tracker is not an official registration record.</p>
        </div>
        <Link className="secondary-btn" to="/student/planner">Open assignment & study planner</Link>
      </header>

      <div className="portal-stats">
        <section><BookOpen /><b>{courses.filter((course) => course.status !== 'withdrawn').length}</b><span>Tracked courses</span></section>
        <section><Check /><b>{totalUnits}</b><span>Credit units listed</span></section>
        <section><CalendarDays /><b>{courses.filter((course) => course.status === 'completed').length}</b><span>Marked completed</span></section>
        <section><CalendarDays /><b>{courses.filter((course) => course.status === 'in_progress').length}</b><span>In progress</span></section>
      </div>

      <div className="segmented-pills" role="tablist" aria-label="Academic sections">
        {ACADEMICS_VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className={`segmented-pill ${view === item.key ? 'active' : ''}`}
            onClick={() => setView(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <p className="inline-notice is-error" role="alert">{error}</p>}

      {/* These panels read their own data and only need the course tracker for
          context, so they stay mounted independently of the catalogue load. */}
      {view === 'workspace' && <CourseWorkspace courses={courses} />}
      {view === 'assignments' && <AssignmentsPanel courses={courses} />}
      {view === 'timetable' && <TimetablePanel courses={courses} />}
      {view === 'calendar' && <CalendarPanel />}
      {view === 'grades' && <GradesPanel />}

      {view === 'tracker' && (loading ? (
        <div className="portal-empty" role="status"><Loader2 className="empty-icon" /> Loading your course catalogue…</div>
      ) : !department ? (
        <div className="portal-empty">
          <BookOpen className="empty-icon" size={32} />
          <p>Add your department to your profile to load its official course catalogue.</p>
          <Link className="secondary-btn" to="/student/profile">Update profile</Link>
        </div>
      ) : (
        <>
          <section className="platform-card">
            <div className="platform-card-head">
              <div><h3>My course tracker</h3><p className="platform-help">Your choices are private to your account and do not certify enrollment.</p></div>
            </div>
            {courses.length ? (
              <div className="platform-list">
                {courses.map((course) => (
                  <article className="platform-list-item" key={course.trackerId}>
                    <div className="platform-course-copy">
                      <strong>{course.code} · {course.title}</strong>
                      <small>{course.units ?? 'Units not listed'} units · {course.level} · {course.semester}{course.sessionName ? ` · ${course.sessionName}` : ''}</small>
                    </div>
                    <div className="platform-list-meta">
                      <select
                        aria-label={`Progress for ${course.code}`}
                        value={course.status}
                        onChange={(event) => void changeStatus(course, event.target.value as TrackedCourse['status'])}
                      >
                        <option value="registered">Registered</option>
                        <option value="in_progress">In progress</option>
                        <option value="completed">Completed</option>
                        <option value="withdrawn">Withdrawn</option>
                      </select>
                      <Link className="platform-icon-link" to={`/library?course=${encodeURIComponent(course.code)}`} aria-label={`Find ${course.code} library materials`}>
                        <ExternalLink size={16} /> Library materials
                      </Link>
                      <button type="button" className="planner-icon-btn danger" onClick={() => void removeCourse(course)} aria-label={`Remove ${course.code}`}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="portal-empty">
                <p>No courses in your tracker yet. Add them from the catalogue below.</p>
              </div>
            )}
          </section>

          <section className="platform-card">
            <div className="platform-card-head">
              <div><h3>Add a course from the catalogue</h3><p className="platform-help">Catalogue records are read-only and managed by FUW administrators.</p></div>
              <label className="campus-search">
                <Search size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search course code or title" aria-label="Search catalogue" />
              </label>
            </div>
            {availableCourses.length ? (
              <div className="platform-grid">
                {availableCourses.slice(0, 30).map((course) => (
                  <article className="platform-tile" key={course.id}>
                    <div className="platform-tile-top"><strong>{course.code}</strong><span className="status-badge">{course.units ?? '-'} units</span></div>
                    <h4>{course.title}</h4>
                    <p>{course.level} · {course.semester}</p>
                    <button type="button" className="secondary-btn" disabled={savingCourse === course.id} onClick={() => void addCourse(course)}>
                      {savingCourse === course.id ? <Loader2 size={15} /> : <Plus size={15} />} Add to tracker
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="portal-empty">
                <p>{search ? 'No catalogue courses match that search.' : 'All courses in this department are already tracked.'}</p>
              </div>
            )}
            {availableCourses.length > 30 && <p className="platform-help">Showing the first 30 matches. Narrow your search to find another course.</p>}
          </section>
        </>
      ))}
      <p className="platform-disclaimer">Your course tracker and assignments are private notes and are not an official registration record. Lecturers, timetables, examinations, calendar entries and grades are published by FUW administrators and shown exactly as recorded.</p>
      <AcademicsReminderHint />
    </div>
  );
}

type FormField = {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  required?: boolean;
  wide?: boolean;
  /** Renders a FileUploader and stores the returned campus-media path. */
  media?: CampusMediaScope;
  mediaHint?: string;
};
type ListingConfig = {
  title: string;
  heading: string;
  description: string;
  fields: FormField[];
  empty: string;
  createLabel: string;
};

const CONFIG: Record<CampusListingModule, ListingConfig> = {
  events: {
    title: 'Campus events',
    heading: 'Events',
    description: 'Discover published campus events. Your new event remains a private draft until an authorized organizer publishes it.',
    fields: [
      { key: 'title', label: 'Event title', required: true },
      { key: 'category', label: 'Category', type: 'select', options: ['Academic', 'Career', 'Competition', 'Religious', 'Technology', 'Social', 'Workshop', 'Seminar', 'Campus', 'Other'] },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
      { key: 'venue', label: 'Venue' },
      { key: 'starts_at', label: 'Start date and time', type: 'datetime-local', required: true },
      { key: 'ends_at', label: 'End date and time', type: 'datetime-local' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'registration_deadline', label: 'Registration deadline', type: 'datetime-local' },
      { key: 'cover_image_path', label: 'Cover image', media: 'events', wide: true, mediaHint: 'Shown on the event card. JPG, PNG, WebP or PDF, up to 10 MB.' }
    ],
    empty: 'No published events are listed yet.',
    createLabel: 'Propose an event'
  },
  organizations: {
    title: 'Student organizations',
    heading: 'Organizations',
    description: 'Explore published university organizations and request membership. New organizations require review.',
    fields: [
      { key: 'name', label: 'Organization name', required: true },
      { key: 'category', label: 'Category', required: true },
      { key: 'description', label: 'About this organization', type: 'textarea', wide: true }
    ],
    empty: 'No approved organizations have been listed yet.',
    createLabel: 'Propose an organization'
  },
  jobs: {
    title: 'Jobs & gigs',
    heading: 'Opportunities',
    description: 'Browse approved opportunities or submit a listing for moderation.',
    fields: [
      { key: 'title', label: 'Opportunity title', required: true },
      { key: 'employer', label: 'Employer', required: true },
      { key: 'category', label: 'Category' },
      { key: 'location', label: 'Location' },
      { key: 'work_mode', label: 'Work mode', type: 'select', options: ['on_campus', 'remote', 'hybrid'] },
      { key: 'compensation', label: 'Compensation' },
      { key: 'deadline', label: 'Application deadline', type: 'datetime-local' },
      { key: 'requirements', label: 'Requirements', type: 'textarea', wide: true },
      { key: 'application_method', label: 'How to apply', type: 'textarea', wide: true }
    ],
    empty: 'No approved opportunities are available.',
    createLabel: 'Submit an opportunity'
  },
  'lost-found': {
    title: 'Lost & Found',
    heading: 'Safe item recovery',
    description: 'Listings show only the information the owner marked public. Ownership verification details are private to the owner and moderators.',
    fields: [
      { key: 'report_type', label: 'Report type', type: 'select', options: ['lost', 'found'], required: true },
      { key: 'title', label: 'Item title', required: true },
      { key: 'category', label: 'Category', type: 'select', options: ['Phones', 'Wallets', 'IDs', 'Keys', 'Books', 'Bags', 'Electronics', 'Other'], required: true },
      { key: 'location', label: 'Where was it lost or found?' },
      { key: 'item_date', label: 'Date', type: 'date' },
      { key: 'description', label: 'Public description', type: 'textarea', wide: true },
      { key: 'photo_path', label: 'Photo', media: 'lost-found', wide: true, mediaHint: 'A clear photo helps others identify the item. JPG, PNG, WebP or PDF, up to 10 MB.' }
    ],
    empty: 'No open lost-and-found reports.',
    createLabel: 'Report an item'
  },
  'study-groups': {
    title: 'Study groups',
    heading: 'Peer learning',
    description: 'Find published study groups or propose a new group. Shared messages and materials are limited to approved members.',
    fields: [
      { key: 'name', label: 'Group name', required: true },
      { key: 'description', label: 'Study focus', type: 'textarea', wide: true },
      { key: 'is_public', label: 'Visible in group discovery', type: 'checkbox' }
    ],
    empty: 'No approved study groups are listed yet.',
    createLabel: 'Propose a study group'
  },
  services: {
    title: 'Student services',
    heading: 'Services marketplace',
    description: 'Explore published student services. Listings require moderation. Payments are not handled by this platform.',
    fields: [
      { key: 'title', label: 'Service title', required: true },
      { key: 'category', label: 'Category' },
      { key: 'rate', label: 'Rate or price description' },
      { key: 'location', label: 'Location' },
      { key: 'is_remote', label: 'Available remotely', type: 'checkbox' },
      { key: 'contact_method', label: 'Public contact instructions' },
      { key: 'description', label: 'Service description', type: 'textarea', wide: true }
    ],
    empty: 'No approved services are listed yet.',
    createLabel: 'Offer a service'
  }
};

function recordText(row: CampusRow, key: string): string {
  const value = row[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function recordStatus(row: CampusRow): string {
  return recordText(row, 'status') || 'Published';
}

function listingTitle(module: CampusListingModule, row: CampusRow): string {
  if (module === 'organizations' || module === 'study-groups') return recordText(row, 'name');
  if (module === 'lost-found') return recordText(row, 'title');
  return recordText(row, 'title');
}

function listingDetails(module: CampusListingModule, row: CampusRow): string[] {
  if (module === 'events') {
    const starts = recordText(row, 'starts_at');
    return [recordText(row, 'category'), recordText(row, 'venue'), starts && new Date(starts).toLocaleString()];
  }
  if (module === 'organizations') return [recordText(row, 'category')];
  if (module === 'jobs') return [recordText(row, 'employer'), recordText(row, 'category'), recordText(row, 'location'), recordText(row, 'work_mode')];
  if (module === 'lost-found') return [recordText(row, 'report_type').toUpperCase(), recordText(row, 'category'), recordText(row, 'location'), recordText(row, 'item_date')];
  if (module === 'study-groups') return [recordText(row, 'description')];
  return [recordText(row, 'category'), recordText(row, 'rate'), recordText(row, 'location')];
}

export function CampusListingsModule({ module }: { module: CampusListingModule }) {
  const config = CONFIG[module];
  const { toast } = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState<CampusRow[]>([]);
  const [rsvps, setRsvps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  // Paths uploaded while the create form is open, so cancelling can sweep them.
  const uploadedThisSession = useRef<Set<string>>(new Set());
  const [claimItem, setClaimItem] = useState<string | null>(null);
  const [claimDetails, setClaimDetails] = useState('');
  const [reportItem, setReportItem] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState('');
  const [busyId, setBusyId] = useState('');
  const [pendingDelete, setPendingDelete] = useState<CampusRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [items, registered] = await Promise.all([
        fetchCampusListings(module),
        module === 'events' ? fetchMyRsvps() : Promise.resolve([])
      ]);
      setRows(items);
      setRsvps(registered);
      setLoadError('');
    } catch (cause) {
      setLoadError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [module]);

  useEffect(() => { void load(); }, [load]);

  const visibleRows = rows.filter((row) => {
    const query = filter.trim().toLowerCase();
    const searchable = [listingTitle(module, row), ...listingDetails(module, row)].join(' ').toLowerCase();
    return !query || searchable.includes(query);
  });

  const submitListing = async (event: FormEvent) => {
    event.preventDefault();
    const titleField = config.fields.find((field) => field.required);
    if (titleField && !String(form[titleField.key] ?? '').trim()) {
      toast(`${titleField.label} is required.`, 'error');
      return;
    }
    setSaving(true);
    const input: Record<string, unknown> = {};
    for (const field of config.fields) {
      const value = form[field.key];
      if (field.type === 'number') input[field.key] = value ? Number(value) : null;
      else if (field.type === 'checkbox') input[field.key] = value === true;
      else if (field.type === 'datetime-local' && value) input[field.key] = new Date(String(value)).toISOString();
      else if (typeof value === 'string' && value.trim()) input[field.key] = value.trim();
    }
    try {
      await createCampusListing(module, input);
      toast(module === 'lost-found' ? 'Item report created.' : 'Submitted for review. It will not be public until approved.', 'success');
      // The listing now owns these objects, so the cancel sweep must forget them.
      uploadedThisSession.current.clear();
      setForm({});
      setFormOpen(false);
      await load();
    } catch (cause) {
      // Uploads happen while the form is open, so a rejected insert would
      // otherwise leave the file orphaned in the bucket.
      for (const path of uploadedThisSession.current) await removeCampusMedia(path);
      uploadedThisSession.current.clear();
      setForm({});
      toast(errorText(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  /** Discards media uploaded into a form the user walked away from. */
  const discardSessionMedia = async () => {
    for (const path of uploadedThisSession.current) await removeCampusMedia(path);
    uploadedThisSession.current.clear();
  };

  const closeForm = async () => {
    setFormOpen(false);
    setForm({});
    await discardSessionMedia();
  };

  const handleRsvp = async (row: CampusRow) => {
    setBusyId(row.id);
    try {
      if (rsvps.includes(row.id)) {
        await cancelEventRsvp(row.id);
        setRsvps((current) => current.filter((id) => id !== row.id));
        toast('Your RSVP has been cancelled.', 'info');
      } else {
        await rsvpToEvent(row.id);
        setRsvps((current) => [...current, row.id]);
        toast('You are registered for this event.', 'success');
      }
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusyId('');
    }
  };

  const removeOwnListing = async (row: CampusRow) => {
    setBusyId(row.id);
    try {
      await deleteCampusListing(module, row.id);
      setRows((current) => current.filter((item) => item.id !== row.id));
      toast('Your listing was removed.', 'info');
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusyId('');
    }
  };

  const requestJoin = async (row: CampusRow) => {
    setBusyId(row.id);
    try {
      if (module === 'organizations') await requestOrganizationMembership(row.id);
      else await joinStudyGroup(row.id);
      toast('Your request has been sent for approval.', 'success');
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusyId('');
    }
  };

  const sendClaim = async (event: FormEvent) => {
    event.preventDefault();
    if (!claimItem || claimDetails.trim().length < 10) {
      toast('Add at least 10 characters of private ownership details.', 'error');
      return;
    }
    setBusyId(claimItem);
    try {
      await createLostFoundClaim(claimItem, claimDetails);
      toast('Your private ownership claim has been sent to the item owner.', 'success');
      setClaimItem(null);
      setClaimDetails('');
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusyId('');
    }
  };

  const sendReport = async (event: FormEvent) => {
    event.preventDefault();
    if (!reportItem || reportDetails.trim().length < 10) {
      toast('Describe the issue in at least 10 characters.', 'error');
      return;
    }
    setBusyId(reportItem);
    try {
      await reportCampusListing(module, reportItem, reportDetails);
      toast('Report submitted for moderation.', 'success');
      setReportItem(null);
      setReportDetails('');
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="portal-view-fade platform-shell">
      <header className="platform-header">
        <div><p className="kicker">{config.heading.toUpperCase()}</p><h2>{config.title}</h2><p className="subtitle">{config.description}</p></div>
        <button type="button" className="primary" onClick={() => void (formOpen ? closeForm() : setFormOpen(true))}>
          <Plus size={16} /> {formOpen ? 'Close form' : config.createLabel}
        </button>
      </header>

      {formOpen && (
        <form className="platform-form" onSubmit={submitListing}>
          <div className="platform-form-grid">
            {config.fields.map((field) => field.media ? (
              <div className={field.wide ? 'platform-field platform-field-wide' : 'platform-field'} key={field.key}>
                <span>{field.label}{field.required ? ' *' : ''}</span>
                <FileUploader
                  scope={field.media}
                  value={(form[field.key] as string) || null}
                  onChange={(path) => {
                    const previous = form[field.key] as string;
                    if (previous && previous !== path) uploadedThisSession.current.delete(previous);
                    if (path) uploadedThisSession.current.add(path);
                    else uploadedThisSession.current.delete(previous);
                    setForm((current) => ({ ...current, [field.key]: path ?? '' }));
                  }}
                  label={`Add ${field.label.toLowerCase()}`}
                  hint={field.mediaHint}
                  onError={(message) => toast(message, 'error')}
                />
              </div>
            ) : (
              <label className={field.wide ? 'platform-field platform-field-wide' : 'platform-field'} key={field.key}>
                {field.type === 'checkbox' ? (
                  <span className="platform-checkbox-label">
                    <input type="checkbox" checked={form[field.key] === true} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.checked }))} />
                    {field.label}
                  </span>
                ) : (
                  <>
                    <span>{field.label}{field.required ? ' *' : ''}</span>
                    {field.type === 'select' ? (
                      <select required={field.required} value={String(form[field.key] ?? field.options?.[0] ?? '')} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}>
                        {(field.options ?? []).map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea required={field.required} value={String(form[field.key] ?? '')} maxLength={4000} rows={4} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
                    ) : (
                      <input required={field.required} type={field.type ?? 'text'} min={field.type === 'number' ? '1' : undefined} value={String(form[field.key] ?? '')} maxLength={field.type === 'number' ? undefined : 180} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
                    )}
                  </>
                )}
              </label>
            ))}
          </div>
          <p className="platform-help">Listings are tied to your signed-in account. Approval and visibility are enforced by the platform, not this form.</p>
          <div className="platform-form-actions">
            <button type="button" className="secondary-btn" onClick={() => void closeForm()}>Cancel</button>
            <button className="primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit for review'}</button>
          </div>
        </form>
      )}

      <label className="campus-search">
        <Search size={15} />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={`Search ${config.title.toLowerCase()}`} aria-label={`Search ${config.title}`} />
      </label>

      {loadError && <p className="inline-notice is-error" role="alert">{loadError}</p>}
      {loading ? (
        <div className="portal-empty" role="status"><Loader2 className="empty-icon" /> Loading listings…</div>
      ) : visibleRows.length === 0 ? (
        <div className="portal-empty">
          <Flag className="empty-icon" size={32} />
          <p>{filter ? 'No listings match your search.' : config.empty}</p>
          <span>Use “{config.createLabel}” to contribute where submissions are available.</span>
        </div>
      ) : (
        <div className="platform-grid three-up">
          {visibleRows.map((row) => {
            const ownerId = recordText(row, 'organizer_id') || recordText(row, 'owner_id');
            const owned = Boolean(user?.id && ownerId === user.id);
            const published = recordStatus(row) === 'published' || recordStatus(row) === 'open';
            return (
              <article className="platform-tile campus-listing" key={row.id}>
                <div className="platform-tile-top">
                  <strong>{listingDetails(module, row).filter(Boolean)[0] || config.heading}</strong>
                  <span className="status-badge">{recordStatus(row)}</span>
                </div>
                <h4>{listingTitle(module, row)}</h4>
                <p>{listingDetails(module, row).filter(Boolean).slice(1).join(' · ') || 'Details not provided.'}</p>
                {(module === 'lost-found' || module === 'events') && (
                  <div className="campus-listing-media">
                    <MediaThumbnail
                      path={recordText(row, module === 'events' ? 'cover_image_path' : 'photo_path') || null}
                      alt={`Media attached to ${listingTitle(module, row)}`}
                    />
                    <p className="campus-listing-description">{recordText(row, 'description')}</p>
                  </div>
                )}
                {(module === 'jobs' || module === 'services') && recordText(row, 'description') && <p className="campus-listing-description">{recordText(row, 'description')}</p>}

                {module === 'events' && published && (
                  <button type="button" className="secondary-btn" disabled={busyId === row.id} onClick={() => void handleRsvp(row)}>
                    {busyId === row.id ? 'Saving…' : rsvps.includes(row.id) ? 'Cancel RSVP' : 'RSVP'}
                  </button>
                )}
                {(module === 'organizations' || module === 'study-groups') && published && (
                  <button type="button" className="secondary-btn" disabled={busyId === row.id} onClick={() => void requestJoin(row)}>
                    {busyId === row.id ? 'Sending…' : 'Request to join'}
                  </button>
                )}
                {module === 'lost-found' && !owned && recordStatus(row) !== 'closed' && (
                  <button type="button" className="secondary-btn" onClick={() => setClaimItem(row.id)}>Claim this item</button>
                )}
                {owned && ['draft', 'pending', 'open'].includes(recordStatus(row)) && (
                  <button type="button" className="campus-report-button" disabled={busyId === row.id} onClick={() => setPendingDelete(row)}>
                    <Trash2 size={13} /> Delete my listing
                  </button>
                )}
                {!owned && (
                  <button type="button" className="campus-report-button" onClick={() => setReportItem(row.id)}><Flag size={13} /> Report listing</button>
                )}
                {claimItem === row.id && (
                  <form className="campus-inline-form" onSubmit={sendClaim}>
                    <label>Private verification details<textarea value={claimDetails} onChange={(event) => setClaimDetails(event.target.value)} minLength={10} maxLength={4000} required rows={3} placeholder="Include identifying details that were not in the public listing." /></label>
                    <button className="primary" disabled={busyId === row.id}>Send private claim</button>
                    <button type="button" className="secondary-btn" onClick={() => setClaimItem(null)}>Cancel</button>
                  </form>
                )}
                {reportItem === row.id && (
                  <form className="campus-inline-form" onSubmit={sendReport}>
                    <label>Why are you reporting this listing?<textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} minLength={10} maxLength={4000} required rows={3} /></label>
                    <button className="primary" disabled={busyId === row.id}>Send report</button>
                    <button type="button" className="secondary-btn" onClick={() => setReportItem(null)}>Cancel</button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
      {module === 'services' && <p className="platform-disclaimer">No payments are collected, held, or represented here. Contact providers independently and exercise caution.</p>}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete your listing?"
        message="This will permanently remove the listing and cannot be undone."
        confirmLabel="Delete listing"
        tone="danger"
        onConfirm={() => pendingDelete ? removeOwnListing(pendingDelete) : undefined}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
