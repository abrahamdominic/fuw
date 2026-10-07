// Administrator-facing academic management: lecturers and their course
// allocations, timetables, examinations, the institutional calendar, grades and
// grading scales.
//
// The UI hides what a permission does not allow, but that is presentation only.
// Every mutation below goes through an RPC that re-checks has_permission()
// server-side, so a hand-crafted request from an unprivileged admin is rejected
// by the database rather than by this component.
import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Award, CalendarDays, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  ACADEMIC_EVENT_TYPES,
  adminDeleteAcademicEvent,
  adminDeleteCalendarEntry,
  adminDeleteCourseSchedule,
  adminDeleteGrade,
  adminDeleteLecturer,
  adminRecordGrade,
  adminSetDefaultGradingScale,
  adminSetGradingScale,
  adminUpsertAcademicEvent,
  adminUpsertCalendarEntry,
  adminUpsertCourseLecturer,
  adminUpsertCourseSchedule,
  adminUpsertLecturer,
  AcademicEventType,
  CALENDAR_CATEGORIES,
  CalendarCategory,
  CourseSchedule,
  DAY_NAMES,
  fetchAcademicEvents,
  fetchAcademicSessionOptions,
  fetchAllGrades,
  fetchCalendarEntries,
  fetchCourseLecturers,
  fetchCourseOptions,
  fetchDepartmentOptions,
  fetchGradingScales,
  fetchLecturers,
  fetchSchedules,
  formatDate,
  formatDateTime,
  formatRange,
  GradingScale,
  GradeScaleBandInput,
  Lecturer
} from '../lib/academics';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/AuthContext';
import { useToast } from './Toast';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not complete that request.';
}

type AdminView =
  | 'lecturers'
  | 'allocations'
  | 'timetable'
  | 'exams'
  | 'calendar'
  | 'grades'
  | 'scales';

function useLoader<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loader());
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, error, reload };
}

function Busy({ label }: { label: string }) {
  return (
    <div className="portal-empty" role="status">
      <Loader2 className="empty-icon" /> {label}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Lecturers                                                                  */
/* -------------------------------------------------------------------------- */

function LecturersPanel({ editable }: { editable: boolean }) {
  const { toast } = useToast();
  const { data, loading, error, reload } = useLoader(() => fetchLecturers(true), []);
  const departments = useLoader(fetchDepartmentOptions, []);
  const [editing, setEditing] = useState<Lecturer | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    departmentId: '',
    staffEmail: '',
    phone: '',
    officeLocation: '',
    academicRank: '',
    bio: '',
    isActive: true
  });

  const lecturers = data ?? [];

  const startEdit = (row: Lecturer | null) => {
    setEditing(row);
    setForm({
      fullName: row?.fullName ?? '',
      departmentId: row?.departmentId ?? '',
      staffEmail: row?.staffEmail ?? '',
      phone: row?.phone ?? '',
      officeLocation: row?.officeLocation ?? '',
      academicRank: row?.academicRank ?? '',
      bio: row?.bio ?? '',
      isActive: row?.isActive ?? true
    });
    setOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.fullName.trim().length < 2) {
      toast('Enter the lecturer’s full name.', 'error');
      return;
    }
    setSaving(true);
    try {
      await adminUpsertLecturer({
        id: editing?.id ?? null,
        fullName: form.fullName.trim(),
        departmentId: form.departmentId || null,
        staffEmail: form.staffEmail.trim() || null,
        phone: form.phone.trim() || null,
        officeLocation: form.officeLocation.trim(),
        academicRank: form.academicRank.trim(),
        bio: form.bio.trim(),
        isActive: form.isActive
      });
      toast(editing ? 'Lecturer updated.' : 'Lecturer created.', 'success');
      setOpen(false);
      setEditing(null);
      await reload();
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: Lecturer) => {
    try {
      await adminDeleteLecturer(row.id);
      toast('Lecturer removed.', 'info');
      await reload();
    } catch (cause) {
      toast(errorText(cause), 'error');
    }
  };

  if (loading) return <Busy label="Loading lecturers…" />;
  if (error) return <p className="inline-notice is-error" role="alert">{error}</p>;

  return (
    <section className="platform-card">
      <div className="platform-card-head">
        <div>
          <h3>Lecturer directory</h3>
          <p className="platform-help">
            The platform never invents a lecturer record. Names shown here are entered by staff and
            appear on timetables and course pages.
          </p>
        </div>
        {editable && (
          <button type="button" className="primary" onClick={() => startEdit(null)}>
            <Plus size={15} /> Add lecturer
          </button>
        )}
      </div>

      {open && (
        <form className="platform-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Full name</span>
            <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
          </label>
          <label>
            <span>Department</span>
            <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">Not assigned</option>
              {(departments.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Academic rank</span>
            <input value={form.academicRank} onChange={(e) => setForm({ ...form, academicRank: e.target.value })} placeholder="Senior Lecturer" />
          </label>
          <label>
            <span>Office</span>
            <input value={form.officeLocation} onChange={(e) => setForm({ ...form, officeLocation: e.target.value })} />
          </label>
          <label>
            <span>Staff email</span>
            <input type="email" value={form.staffEmail} onChange={(e) => setForm({ ...form, staffEmail: e.target.value })} />
          </label>
          <label>
            <span>Phone</span>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            <span>Currently employed</span>
          </label>
          <label className="wide">
            <span>Bio</span>
            <textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </label>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? <Loader2 size={15} /> : null} Save lecturer
          </button>
        </form>
      )}

      {lecturers.length === 0 ? (
        <div className="portal-empty"><p>No lecturers have been added yet.</p></div>
      ) : (
        <div className="table-scroll-wrapper">
          <table className="admin-table">
            <thead>
              <tr><th>Name</th><th>Department</th><th>Rank</th><th>Office</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {lecturers.map((row) => (
                <tr key={row.id}>
                  <td className="cell-bold">{row.fullName}</td>
                  <td>{row.departmentName ?? '-'}</td>
                  <td>{row.academicRank || '-'}</td>
                  <td>{row.officeLocation || '-'}</td>
                  <td>
                    <span className={`status-badge ${row.isActive ? 'approved' : 'inactive'}`}>
                      {row.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    {editable && (
                      <span className="courses-actions">
                        <button type="button" className="table-action-btn" onClick={() => startEdit(row)}>Edit</button>
                        <button type="button" className="table-action-btn danger" onClick={() => void remove(row)}>
                          <Trash2 size={14} />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Course allocations                                                         */
/* -------------------------------------------------------------------------- */

function AllocationsPanel({ editable }: { editable: boolean }) {
  const { toast } = useToast();
  const courses = useLoader(fetchCourseOptions, []);
  const lecturers = useLoader(() => fetchLecturers(false), []);
  const sessions = useLoader(fetchAcademicSessionOptions, []);
  const [courseId, setCourseId] = useState('');
  const [allocations, setAllocations] = useState<Awaited<ReturnType<typeof fetchCourseLecturers>>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ lecturerId: '', sessionId: '', isPrimary: true });

  const load = useCallback(async () => {
    if (!courseId) {
      setAllocations([]);
      return;
    }
    setLoading(true);
    try {
      setAllocations(await fetchCourseLecturers(courseId));
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setLoading(false);
    }
  }, [courseId, toast]);

  useEffect(() => { void load(); }, [load]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!courseId || !form.lecturerId) {
      toast('Choose a course and a lecturer.', 'error');
      return;
    }
    setSaving(true);
    try {
      await adminUpsertCourseLecturer({
        courseId,
        lecturerId: form.lecturerId,
        academicSessionId: form.sessionId || null,
        isPrimary: form.isPrimary
      });
      toast('Allocation saved.', 'success');
      setForm({ lecturerId: '', sessionId: '', isPrimary: true });
      await load();
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="platform-card">
      <div className="platform-card-head">
        <div>
          <h3>Course allocations</h3>
          <p className="platform-help">Assign lecturers to the courses they teach.</p>
        </div>
        <label className="campus-search">
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Course">
            <option value="">Choose a course…</option>
            {(courses.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.code} · {row.title}</option>
            ))}
          </select>
        </label>
      </div>

      {!courseId ? (
        <div className="portal-empty"><p>Choose a course to see and manage its lecturers.</p></div>
      ) : loading ? (
        <Busy label="Loading allocations…" />
      ) : (
        <>
          {allocations.length > 0 && (
            <div className="platform-list">
              {allocations.map((row) => (
                <article className="platform-list-item" key={row.id}>
                  <div className="platform-course-copy">
                    <strong>{row.lecturerName ?? 'Unknown lecturer'}</strong>
                    <small>{row.sessionName ?? 'All sessions'}{row.isPrimary ? ' · primary lecturer' : ''}</small>
                  </div>
                </article>
              ))}
            </div>
          )}

          {editable ? (
            <form className="platform-form" onSubmit={(event) => void add(event)}>
              <label>
                <span>Lecturer</span>
                <select value={form.lecturerId} onChange={(e) => setForm({ ...form, lecturerId: e.target.value })} required>
                  <option value="">Choose…</option>
                  {(lecturers.data ?? []).map((row) => (
                    <option key={row.id} value={row.id}>{row.fullName}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Session</span>
                <select value={form.sessionId} onChange={(e) => setForm({ ...form, sessionId: e.target.value })}>
                  <option value="">All sessions</option>
                  {(sessions.data ?? []).map((row) => (
                    <option key={row.id} value={row.id}>{row.name}{row.isActive ? ' (active)' : ''}</option>
                  ))}
                </select>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
                <span>Primary lecturer</span>
              </label>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? <Loader2 size={15} /> : <Plus size={15} />} Allocate
              </button>
            </form>
          ) : (
            !allocations.length && <div className="portal-empty"><p>No lecturers are allocated to this course yet.</p></div>
          )}
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Timetable                                                                  */
/* -------------------------------------------------------------------------- */

function TimetablePanel({ editable }: { editable: boolean }) {
  const { toast } = useToast();
  const courses = useLoader(fetchCourseOptions, []);
  const lecturers = useLoader(() => fetchLecturers(false), []);
  const [rows, setRows] = useState<CourseSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    courseId: '',
    lecturerId: '',
    dayOfWeek: 1,
    startsAt: '08:00',
    endsAt: '10:00',
    venue: ''
  });

  const load = useCallback(async (courseId: string) => {
    if (!courseId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      setRows(await fetchSchedules([courseId]));
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(form.courseId); }, [form.courseId, load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.courseId) {
      toast('Choose a course.', 'error');
      return;
    }
    if (form.endsAt <= form.startsAt) {
      toast('The end time must be after the start time.', 'error');
      return;
    }
    setSaving(true);
    try {
      await adminUpsertCourseSchedule({
        courseId: form.courseId,
        lecturerId: form.lecturerId || null,
        dayOfWeek: form.dayOfWeek,
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        venue: form.venue.trim()
      });
      toast('Meeting saved.', 'success');
      await load(form.courseId);
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: CourseSchedule) => {
    try {
      await adminDeleteCourseSchedule(row.id);
      toast('Meeting removed.', 'info');
      await load(form.courseId);
    } catch (cause) {
      toast(errorText(cause), 'error');
    }
  };

  return (
    <section className="platform-card">
      <div className="platform-card-head">
        <div>
          <h3>Timetable</h3>
          <p className="platform-help">Published meeting times are visible to every student tracking the course.</p>
        </div>
      </div>

      <form className="platform-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>Course</span>
          <select value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })} required>
            <option value="">Choose a course…</option>
            {(courses.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.code} · {row.title}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Lecturer</span>
          <select value={form.lecturerId} onChange={(e) => setForm({ ...form, lecturerId: e.target.value })}>
            <option value="">Not published</option>
            {(lecturers.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.fullName}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Day</span>
          <select value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}>
            {DAY_NAMES.map((day, index) => (
              <option key={day} value={index}>{day}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Starts</span>
          <input type="time" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
        </label>
        <label>
          <span>Ends</span>
          <input type="time" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
        </label>
        <label>
          <span>Venue</span>
          <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="LT 4" />
        </label>
        {editable && (
          <button type="submit" className="primary" disabled={saving}>
            {saving ? <Loader2 size={15} /> : <Plus size={15} />} Add meeting
          </button>
        )}
      </form>

      {loading ? (
        <Busy label="Loading meetings…" />
      ) : rows.length ? (
        <div className="table-scroll-wrapper">
          <table className="admin-table">
            <thead>
              <tr><th>Day</th><th>Time</th><th>Venue</th><th>Lecturer</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="cell-bold">{DAY_NAMES[row.dayOfWeek] ?? row.dayOfWeek}</td>
                  <td>{formatRange(row.startsAt, row.endsAt)}</td>
                  <td>{row.venue || '-'}</td>
                  <td className="cell-secondary">{row.lecturerName ?? 'Not published'}</td>
                  <td>
                    {editable && (
                      <button type="button" className="table-action-btn danger" onClick={() => void remove(row)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="portal-empty"><p>{form.courseId ? 'No meetings scheduled for this course.' : 'Choose a course to manage its timetable.'}</p></div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Examinations                                                               */
/* -------------------------------------------------------------------------- */

function ExamsPanel({ editable }: { editable: boolean }) {
  const { toast } = useToast();
  const courses = useLoader(fetchCourseOptions, []);
  const [courseId, setCourseId] = useState('');
  const [events, setEvents] = useState<Awaited<ReturnType<typeof fetchAcademicEvents>>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    eventType: 'test' as AcademicEventType,
    startsAt: '',
    venue: '',
    notes: ''
  });

  const load = useCallback(async (id: string) => {
    if (!id) {
      setEvents([]);
      return;
    }
    setLoading(true);
    try {
      setEvents(await fetchAcademicEvents([id]));
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(courseId); }, [courseId, load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!courseId || !form.startsAt) {
      toast('Choose a course and a start time.', 'error');
      return;
    }
    setSaving(true);
    try {
      await adminUpsertAcademicEvent({
        courseId,
        title: form.title.trim(),
        eventType: form.eventType,
        startsAt: new Date(form.startsAt).toISOString(),
        venue: form.venue.trim(),
        notes: form.notes.trim()
      });
      toast(`${form.eventType === 'test' ? 'Test' : 'Examination'} scheduled.`, 'success');
      setForm({ title: '', eventType: 'test', startsAt: '', venue: '', notes: '' });
      await load(courseId);
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await adminDeleteAcademicEvent(id);
      toast('Event removed.', 'info');
      await load(courseId);
    } catch (cause) {
      toast(errorText(cause), 'error');
    }
  };

  return (
    <section className="platform-card">
      <div className="platform-card-head">
        <div>
          <h3>Tests &amp; examinations</h3>
          <p className="platform-help">
            Students tracking the course see these, and receive a reminder 24 hours beforehand if they
            have academic notifications enabled.
          </p>
        </div>
      </div>

      <form className="platform-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>Course</span>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} required>
            <option value="">Choose a course…</option>
            {(courses.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.code} · {row.title}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Title</span>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Mid-semester test" />
        </label>
        <label>
          <span>Type</span>
          <select value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value as AcademicEventType })}>
            {ACADEMIC_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>{type === 'test' ? 'Test' : 'Examination'}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Starts</span>
          <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
        </label>
        <label>
          <span>Venue</span>
          <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
        </label>
        <label className="wide">
          <span>Notes</span>
          <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        {editable && (
          <button type="submit" className="primary" disabled={saving}>
            {saving ? <Loader2 size={15} /> : <Plus size={15} />} Schedule
          </button>
        )}
      </form>

      {loading ? (
        <Busy label="Loading events…" />
      ) : events.length ? (
        <div className="platform-list">
          {events.map((row) => (
            <article className="platform-list-item" key={row.id}>
              <div className="platform-course-copy">
                <strong>{row.title}</strong>
                <small>{formatDateTime(row.startsAt)}{row.venue ? ` · ${row.venue}` : ''}</small>
              </div>
              <div className="platform-list-meta">
                <span className="status-badge pending">{row.eventType === 'test' ? 'Test' : 'Examination'}</span>
                {editable && (
                  <button type="button" className="planner-icon-btn danger" aria-label={`Remove ${row.title}`} onClick={() => void remove(row.id)}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="portal-empty"><p>{courseId ? 'No tests or examinations scheduled for this course.' : 'Choose a course to manage its examinations.'}</p></div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                   */
/* -------------------------------------------------------------------------- */

function CalendarPanel({ editable }: { editable: boolean }) {
  const { toast } = useToast();
  const { data, loading, error, reload } = useLoader(fetchCalendarEntries, []);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Lectures' as CalendarCategory,
    startsOn: '',
    endsOn: '',
    isPublished: true
  });

  const entries = data ?? [];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.startsOn) {
      toast('Choose a start date.', 'error');
      return;
    }
    setSaving(true);
    try {
      await adminUpsertCalendarEntry({
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        startsOn: form.startsOn,
        // A single-day entry is the common case, so default the end to the start.
        endsOn: form.endsOn || form.startsOn,
        isPublished: form.isPublished
      });
      toast('Calendar entry saved.', 'success');
      setForm({ title: '', description: '', category: 'Lectures', startsOn: '', endsOn: '', isPublished: true });
      await reload();
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await adminDeleteCalendarEntry(id);
      toast('Entry removed.', 'info');
      await reload();
    } catch (cause) {
      toast(errorText(cause), 'error');
    }
  };

  if (loading) return <Busy label="Loading the calendar…" />;

  return (
    <>
      {error && <p className="inline-notice is-error" role="alert">{error}</p>}
      {editable && (
        <section className="platform-card">
          <div className="platform-card-head">
            <div>
              <h3>Add an entry</h3>
              <p className="platform-help">Unpublished entries stay hidden from students.</p>
            </div>
          </div>
          <form className="platform-form" onSubmit={(event) => void submit(event)}>
            <label>
              <span>Title</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </label>
            <label>
              <span>Category</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CalendarCategory })}>
                {CALENDAR_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Starts</span>
              <input type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} required />
            </label>
            <label>
              <span>Ends</span>
              <input type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} />
              <span>Published</span>
            </label>
            <label className="wide">
              <span>Description</span>
              <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? <Loader2 size={15} /> : <CalendarDays size={15} />} Save entry
            </button>
          </form>
        </section>
      )}

      <section className="platform-card">
        <div className="platform-card-head"><h3>Calendar entries</h3></div>
        {entries.length === 0 ? (
          <div className="portal-empty"><p>No calendar entries yet.</p></div>
        ) : (
          <div className="table-scroll-wrapper">
            <table className="admin-table">
              <thead><tr><th>Title</th><th>Category</th><th>Starts</th><th>Ends</th><th>Status</th><th /></tr></thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id}>
                    <td className="cell-bold">{row.title}</td>
                    <td>{row.category}</td>
                    <td>{formatDate(row.startsOn)}</td>
                    <td>{formatDate(row.endsOn)}</td>
                    <td>
                      <span className={`status-badge ${row.isPublished ? 'approved' : 'pending'}`}>
                        {row.isPublished ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td>
                      {editable && (
                        <button type="button" className="table-action-btn danger" onClick={() => void remove(row.id)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Grades                                                                     */
/* -------------------------------------------------------------------------- */

function GradesPanel({ editable }: { editable: boolean }) {
  const { toast } = useToast();
  const { data, loading, error, reload } = useLoader(fetchAllGrades, []);
  const courses = useLoader(fetchCourseOptions, []);
  const scales = useLoader(() => fetchGradingScales(false), []);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ studentId: '', courseId: '', letter: 'A', units: '3', isPublished: false });

  const rows = data ?? [];
  const scale = (scales.data ?? []).find((row) => row.isDefault) ?? null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.studentId || !form.courseId) {
      toast('Choose a student and a course.', 'error');
      return;
    }
    setSaving(true);
    try {
      await adminRecordGrade({
        studentId: form.studentId,
        courseId: form.courseId,
        gradeLetter: form.letter,
        units: form.units ? Number(form.units) : null,
        isPublished: form.isPublished
      });
      toast(
        form.isPublished
          ? 'Result published. The student has been notified.'
          : 'Result saved as a draft. The student cannot see it yet.',
        'success'
      );
      setForm({ ...form, studentId: '', courseId: '' });
      await reload();
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await adminDeleteGrade(id);
      toast('Result removed.', 'info');
      await reload();
    } catch (cause) {
      toast(errorText(cause), 'error');
    }
  };

  if (loading) return <Busy label="Loading results…" />;

  return (
    <>
      {error && <p className="inline-notice is-error" role="alert">{error}</p>}

      {editable && (
        <section className="platform-card">
          <div className="platform-card-head">
            <div>
              <h3>Record a result</h3>
              <p className="platform-help">
                The grade point is derived from the {scale?.name ?? 'default'} scale, so the letter is the
                only value you supply. Publishing notifies the student exactly once.
              </p>
            </div>
          </div>
          <form className="platform-form" onSubmit={(event) => void submit(event)}>
            <label>
              <span>Student ID (UUID)</span>
              <input value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} required placeholder="Paste the student’s profile id" />
            </label>
            <label>
              <span>Course</span>
              <select value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })} required>
                <option value="">Choose…</option>
                {(courses.data ?? []).map((row) => (
                  <option key={row.id} value={row.id}>{row.code} · {row.title}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Grade</span>
              <select value={form.letter} onChange={(e) => setForm({ ...form, letter: e.target.value })}>
                {(scale?.bands ?? []).map((band) => (
                  <option key={band.id} value={band.letter}>
                    {band.letter} · {band.gradePoint} pts
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Units</span>
              <input type="number" min={0} step={0.5} value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} />
              <span>Publish to the student</span>
            </label>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? <Loader2 size={15} /> : <Award size={15} />} Save result
            </button>
          </form>
          <p className="platform-help">
            Student IDs are UUIDs from <code>profiles.id</code>. A future registrar import can populate
            this without hand-copying them.
          </p>
        </section>
      )}

      <section className="platform-card">
        <div className="platform-card-head"><h3>All results</h3></div>
        {rows.length === 0 ? (
          <div className="portal-empty"><p>No results have been recorded yet.</p></div>
        ) : (
          <div className="table-scroll-wrapper">
            <table className="admin-table">
              <thead><tr><th>Student</th><th>Course</th><th>Units</th><th>Grade</th><th>Point</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="cell-bold">{row.studentName}</td>
                    <td>{row.courseCode}</td>
                    <td>{row.units ?? '-'}</td>
                    <td>{row.gradeLetter}</td>
                    <td>{row.gradePoint.toFixed(2)}</td>
                    <td>
                      <span className={`status-badge ${row.isPublished ? 'approved' : 'pending'}`}>
                        {row.isPublished ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td>
                      {editable && (
                        <button type="button" className="table-action-btn danger" onClick={() => void remove(row.id)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Grading scales                                                             */
/* -------------------------------------------------------------------------- */

function ScalesPanel({ editable }: { editable: boolean }) {
  const { toast } = useToast();
  const { data, loading, error, reload } = useLoader(() => fetchGradingScales(true), []);
  const [editing, setEditing] = useState<GradingScale | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [bands, setBands] = useState<GradeScaleBandInput[]>([]);
  const [saving, setSaving] = useState(false);

  const scales = data ?? [];

  const startEdit = (scale: GradingScale | null) => {
    setEditing(scale);
    setName(scale?.name ?? '');
    setDescription(scale?.description ?? '');
    setBands(
      scale?.bands.map((band) => ({
        letter: band.letter,
        gradePoint: band.gradePoint,
        minScore: band.minScore,
        maxScore: band.maxScore,
        isPassing: band.isPassing
      })) ?? []
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (!name.trim()) {
      toast('Give the scale a name.', 'error');
      return;
    }
    if (!bands.length) {
      toast('A scale needs at least one band.', 'error');
      return;
    }
    const letters = new Set(bands.map((band) => band.letter.trim().toUpperCase()));
    if (letters.size !== bands.length) {
      toast('Grade letters must be unique.', 'error');
      return;
    }
    setSaving(true);
    try {
      await adminSetGradingScale({
        scaleId: editing.id,
        name: name.trim(),
        description: description.trim(),
        bands: bands.map((band) => ({ ...band, letter: band.letter.trim().toUpperCase() }))
      });
      toast('Grading scale saved.', 'success');
      setEditing(null);
      await reload();
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const makeDefault = async (scale: GradingScale) => {
    try {
      await adminSetDefaultGradingScale(scale.id);
      toast(`${scale.name} is now the default scale.`, 'success');
      await reload();
    } catch (cause) {
      toast(errorText(cause), 'error');
    }
  };

  if (loading) return <Busy label="Loading grading scales…" />;

  return (
    <>
      {error && <p className="inline-notice is-error" role="alert">{error}</p>}
      {editing && (
        <section className="platform-card">
          <div className="platform-card-head">
            <div>
              <h3>Edit {editing.name}</h3>
              <p className="platform-help">Saving replaces every band on this scale. Existing grades keep the point they were recorded with.</p>
            </div>
          </div>
          <form className="platform-form" onSubmit={(event) => void submit(event)}>
            <label>
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="wide">
              <span>Description</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <div className="wide">
              <span className="platform-help">Bands</span>
              <div className="table-scroll-wrapper">
                <table className="admin-table">
                  <thead><tr><th>Letter</th><th>Grade point</th><th>Min %</th><th>Max %</th><th>Passing</th><th /></tr></thead>
                  <tbody>
                    {bands.map((band, index) => (
                      <tr key={index}>
                        <td>
                          <input
                            aria-label={`Letter ${index + 1}`}
                            value={band.letter}
                            onChange={(e) => setBands(bands.map((b, i) => (i === index ? { ...b, letter: e.target.value } : b)))}
                          />
                        </td>
                        <td>
                          <input
                            type="number" step={0.01} aria-label={`Grade point ${index + 1}`}
                            value={band.gradePoint}
                            onChange={(e) => setBands(bands.map((b, i) => (i === index ? { ...b, gradePoint: Number(e.target.value) } : b)))}
                          />
                        </td>
                        <td>
                          <input
                            type="number" aria-label={`Minimum score ${index + 1}`}
                            value={band.minScore}
                            onChange={(e) => setBands(bands.map((b, i) => (i === index ? { ...b, minScore: Number(e.target.value) } : b)))}
                          />
                        </td>
                        <td>
                          <input
                            type="number" aria-label={`Maximum score ${index + 1}`}
                            value={band.maxScore}
                            onChange={(e) => setBands(bands.map((b, i) => (i === index ? { ...b, maxScore: Number(e.target.value) } : b)))}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox" aria-label={`Passing ${index + 1}`}
                            checked={band.isPassing}
                            onChange={(e) => setBands(bands.map((b, i) => (i === index ? { ...b, isPassing: e.target.checked } : b)))}
                          />
                        </td>
                        <td>
                          <button type="button" className="table-action-btn danger" onClick={() => setBands(bands.filter((_, i) => i !== index))}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setBands([...bands, { letter: '', gradePoint: 0, minScore: 0, maxScore: 0, isPassing: false }])}
              >
                <Plus size={15} /> Add band
              </button>
            </div>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? <Loader2 size={15} /> : null} Save scale
            </button>
          </form>
        </section>
      )}

      <section className="platform-card">
        <div className="platform-card-head">
          <div>
            <h3>Grading scales</h3>
            <p className="platform-help">The default scale drives the grade calculator and new results.</p>
          </div>
        </div>
        {scales.length === 0 ? (
          <div className="portal-empty"><p>No grading scales are defined.</p></div>
        ) : (
          <div className="platform-list">
            {scales.map((scale) => (
              <article className="platform-list-item" key={scale.id}>
                <div className="platform-course-copy">
                  <strong>{scale.name}{scale.isDefault ? ' · default' : ''}</strong>
                  <small>{scale.bands.map((band) => `${band.letter}=${band.gradePoint}`).join(' · ')}</small>
                </div>
                <div className="platform-list-meta">
                  <span className={`status-badge ${scale.isActive ? 'approved' : 'inactive'}`}>
                    {scale.isActive ? 'Active' : 'Inactive'}
                  </span>
                  {editable && (
                    <>
                      <button type="button" className="table-action-btn" onClick={() => startEdit(scale)}>Edit</button>
                      {!scale.isDefault && (
                        <button type="button" className="table-action-btn" onClick={() => void makeDefault(scale)}>
                          Make default
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

export function AdminAcademicsModule() {
  const { profile } = useAuth();
  const [view, setView] = useState<AdminView>('lecturers');

  const canLecturers = can(profile, 'manage_lecturers');
  const canAcademics = can(profile, 'manage_academics');
  const canCalendar = can(profile, 'manage_calendar');
  const canGrading = can(profile, 'manage_grading');

  const views = useMemo(
    () =>
      [
        { key: 'lecturers' as const, label: 'Lecturers', editable: canLecturers },
        { key: 'allocations' as const, label: 'Allocations', editable: canLecturers },
        { key: 'timetable' as const, label: 'Timetable', editable: canAcademics },
        { key: 'exams' as const, label: 'Tests & exams', editable: canAcademics },
        { key: 'calendar' as const, label: 'Calendar', editable: canCalendar },
        { key: 'grades' as const, label: 'Grades', editable: canAcademics },
        { key: 'scales' as const, label: 'Grading scales', editable: canGrading }
      ],
    [canLecturers, canAcademics, canCalendar, canGrading]
  );

  const active = views.find((item) => item.key === view) ?? views[0];

  return (
    <div className="portal-view-fade platform-shell">
      <header className="platform-header">
        <div>
          <p className="kicker">ACADEMICS · ADMINISTRATION</p>
          <h2>Academic records</h2>
          <p className="subtitle">
            Lecturer, timetable, examination, calendar and result records. Every change here is
            re-checked against your permissions by the database.
          </p>
        </div>
      </header>

      <div className="segmented-pills" role="tablist" aria-label="Academic administration sections">
        {views.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active.key === item.key}
            className={`segmented-pill ${active.key === item.key ? 'active' : ''}`}
            onClick={() => setView(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!active.editable && (
        <p className="inline-notice" role="status">
          You can view this section but not change it because your account is missing the matching permission.
        </p>
      )}

      {active.key === 'lecturers' && <LecturersPanel editable={canLecturers} />}
      {active.key === 'allocations' && <AllocationsPanel editable={canLecturers} />}
      {active.key === 'timetable' && <TimetablePanel editable={canAcademics} />}
      {active.key === 'exams' && <ExamsPanel editable={canAcademics} />}
      {active.key === 'calendar' && <CalendarPanel editable={canCalendar} />}
      {active.key === 'grades' && <GradesPanel editable={canAcademics} />}
      {active.key === 'scales' && <ScalesPanel editable={canGrading} />}
    </div>
  );
}
