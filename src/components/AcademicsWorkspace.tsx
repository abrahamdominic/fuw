// Student-facing academic companion panels: assignments, timetable,
// examinations, the institutional calendar and the grade/GPA view.
//
// Every panel is read-only with respect to official records: students manage
// their own assignments, but lecturers, timetables, examinations, calendar
// entries and grades are all written by administrators through
// permission-checked RPCs. Nothing here trusts a client-supplied role.
import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  Award,
  BellRing,
  BookOpen,
  Calculator,
  CalendarDays,
  Check,
  Clock,
  ExternalLink,
  GraduationCap,
  Loader2,
  Paperclip,
  Plus,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  ACADEMIC_EVENT_TYPES,
  ASSIGNMENT_PRIORITIES,
  AcademicEvent,
  Assignment,
  AssignmentInput,
  AssignmentPriority,
  AssignmentStatus,
  CalculatorCourseInput,
  CalculatorRowState,
  CalendarEntry,
  calculateCgpa,
  createAssignment,
  deleteAssignment,
  dispatchReminders,
  evaluateCalculatorRow,
  fetchAcademicEvents,
  fetchCalendarEntries,
  fetchCourseLecturers,
  fetchDefaultGradingScale,
  fetchMyAssignments,
  fetchMyGpa,
  fetchMyGrades,
  fetchSchedules,
  formatDate,
  formatDateTime,
  formatRange,
  GradingScale,
  DAY_NAMES,
  StudentGrade,
  updateAssignment
} from '../lib/academics';
import { TrackedCourse } from '../lib/campus';
import { getCampusMediaUrl, removeCampusMedia } from '../lib/campusMedia';
import { fetchMaterials } from '../lib/materials';
import { FileUploader } from './FileUploader';
import { useToast } from './Toast';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not complete that request.';
}

const STATUS_LABELS: Record<AssignmentStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted',
  completed: 'Completed'
};

const PRIORITY_LABELS: Record<AssignmentPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent'
};

function Busy({ label }: { label: string }) {
  return (
    <div className="portal-empty" role="status">
      <Loader2 className="empty-icon" /> {label}
    </div>
  );
}

function daysUntil(value: string | null): string {
  if (!value) return 'No due date';
  const due = new Date(value).getTime();
  const diff = due - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (diff < 0) return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[]) {
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
  return { data, setData, loading, error, reload };
}

/* -------------------------------------------------------------------------- */
/* Assignments                                                                */
/* -------------------------------------------------------------------------- */

export function AssignmentsPanel({ courses }: { courses: TrackedCourse[] }) {
  const { toast } = useToast();
  const { data, setData, loading, error, reload } = useAsyncData(fetchMyAssignments, []);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Assignment | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    courseId: '',
    dueDate: '',
    priority: 'normal' as AssignmentPriority,
    remind: true,
    attachmentPath: null as string | null
  });

  const assignments = data ?? [];
  const open = assignments.filter((item) => item.status === 'not_started' || item.status === 'in_progress');
  const settled = assignments.filter((item) => item.status === 'submitted' || item.status === 'completed');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) {
      toast('Give the assignment a title.', 'error');
      return;
    }
    setSaving(true);
    const input: AssignmentInput = {
      title: form.title.trim(),
      description: form.description.trim(),
      courseId: form.courseId || null,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      priority: form.priority,
      attachmentPath: form.attachmentPath,
      // A reminder is scheduled 24h before the deadline, and only when a
      // deadline exists. The server keeps the row pending while the student has
      // muted the academic category, so this is safe to set upfront.
      reminderAt:
        form.remind && form.dueDate
          ? new Date(new Date(form.dueDate).getTime() - 86400000).toISOString()
          : null
    };
    try {
      await createAssignment(input);
      toast('Assignment added.', 'success');
      setForm({ title: '', description: '', courseId: '', dueDate: '', priority: 'normal', remind: true, attachmentPath: null });
      setFormOpen(false);
      await reload();
    } catch (cause) {
      // The file was already stored when it was chosen, so a failed insert
      // would otherwise leave an orphan object in the bucket.
      if (form.attachmentPath) await removeCampusMedia(form.attachmentPath);
      toast(errorText(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (item: Assignment, status: AssignmentStatus) => {
    setBusyId(item.id);
    try {
      await updateAssignment(item.id, { status });
      setData((current) =>
        (current ?? []).map((row) => (row.id === item.id ? { ...row, status } : row))
      );
      toast(status === 'submitted' ? 'Marked as submitted.' : 'Assignment updated.', 'success');
      await reload();
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusyId('');
    }
  };

  const openAttachment = async (item: Assignment) => {
    const url = await getCampusMediaUrl(item.attachmentPath);
    if (!url) {
      toast('That attachment is not available to your account.', 'error');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const runReminders = async () => {
    setBusyId('reminders');
    try {
      const sent = await dispatchReminders();
      toast(
        sent > 0
          ? `${sent} reminder${sent === 1 ? '' : 's'} sent.`
          : 'No reminders are due, or academic notifications are muted.',
        'info'
      );
      await reload();
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusyId('');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id);
    try {
      await deleteAssignment(pendingDelete.id);
      await removeCampusMedia(pendingDelete.attachmentPath);
      toast('Assignment deleted.', 'info');
      setPendingDelete(null);
      await reload();
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusyId('');
    }
  };

  const renderRow = (item: Assignment) => (
    <article className="platform-list-item" key={item.id}>
      <div className="platform-course-copy">
        <strong>{item.title}</strong>
        <small>
          {item.courseCode ? `${item.courseCode} · ` : 'No course · '}
          {item.dueDate ? `${formatDateTime(item.dueDate)} · ${daysUntil(item.dueDate)}` : 'No deadline'}
          {item.submittedAt ? ` · submitted ${formatDate(item.submittedAt)}` : ''}
        </small>
      </div>
      <div className="platform-list-meta">
        <span className="platform-pill priority-pill">{PRIORITY_LABELS[item.priority]}</span>
        <select
          aria-label={`Status for ${item.title}`}
          value={item.status}
          disabled={busyId === item.id}
          onChange={(event) => void changeStatus(item, event.target.value as AssignmentStatus)}
        >
          {(Object.keys(STATUS_LABELS) as AssignmentStatus[]).map((status) => (
            <option key={status} value={status}>{STATUS_LABELS[status]}</option>
          ))}
        </select>
        {item.attachmentPath && (
          <button
            type="button"
            className="planner-icon-btn"
            aria-label={`Open attachment for ${item.title}`}
            onClick={() => void openAttachment(item)}
          >
            <Paperclip size={15} />
          </button>
        )}
        <button
          type="button"
          className="planner-icon-btn danger"
          aria-label={`Delete ${item.title}`}
          onClick={() => setPendingDelete(item)}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );

  return (
    <>
      {error && <p className="inline-notice is-error" role="alert">{error}</p>}
      {loading ? (
        <div className="portal-empty" role="status"><Loader2 className="empty-icon" /> Loading assignments…</div>
      ) : (
        <>
          <section className="platform-card">
            <div className="platform-card-head">
              <div>
                <h3>Outstanding</h3>
                <p className="platform-help">Only you can see these. Submitted timestamps are set by the server, not the browser.</p>
              </div>
              <div className="portal-top-actions">
                <button type="button" className="secondary-btn" disabled={busyId === 'reminders'} onClick={() => void runReminders()}>
                  {busyId === 'reminders' ? <Loader2 size={15} /> : <BellRing size={15} />} Send due reminders
                </button>
                <button type="button" className="primary" onClick={() => setFormOpen((open) => !open)}>
                  {formOpen ? 'Cancel' : <><Plus size={15} /> Add assignment</>}
                </button>
              </div>
            </div>

            {formOpen && (
              <form className="platform-form" onSubmit={(event) => void submit(event)}>
                <label>
                  <span>Title</span>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
                </label>
                <label>
                  <span>Course</span>
                  <select value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })}>
                    <option value="">No course</option>
                    {courses.map((course) => (
                      <option key={course.trackerId} value={course.id}>{course.code} · {course.title}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Deadline</span>
                  <input type="datetime-local" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                </label>
                <label>
                  <span>Priority</span>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as AssignmentPriority })}>
                    {ASSIGNMENT_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>
                    ))}
                  </select>
                </label>
                <label className="wide">
                  <span>Notes</span>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={form.remind} onChange={(e) => setForm({ ...form, remind: e.target.checked })} />
                  <span>Remind me 24 hours before</span>
                </label>
                <label className="wide">
                  <span>Attachment</span>
                  <FileUploader
                    scope="assignments"
                    value={form.attachmentPath}
                    onChange={(path) => setForm((current) => ({ ...current, attachmentPath: path }))}
                    label="Attach the brief or supporting file"
                    onError={(message) => toast(message, 'error')}
                  />
                </label>
                <button type="submit" className="primary" disabled={saving}>
                  {saving ? <Loader2 size={15} /> : <Check size={15} />} Save assignment
                </button>
              </form>
            )}

            {open.length ? (
              <div className="platform-list">{open.map(renderRow)}</div>
            ) : (
              <div className="portal-empty"><p>Nothing outstanding. Add an assignment to start tracking it.</p></div>
            )}
          </section>

          {settled.length > 0 && (
            <section className="platform-card">
              <div className="platform-card-head"><h3>Submitted &amp; completed</h3></div>
              <div className="platform-list">{settled.map(renderRow)}</div>
            </section>
          )}
        </>
      )}

      {pendingDelete && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>Delete this assignment?</h3>
            <p>{pendingDelete.title} will be removed from your list. This cannot be undone.</p>
            <div className="portal-top-actions">
              <button type="button" className="secondary-btn" onClick={() => setPendingDelete(null)}>Keep it</button>
              <button type="button" className="primary danger" onClick={() => void confirmDelete()}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Timetable and examinations                                                 */
/* -------------------------------------------------------------------------- */

export function TimetablePanel({ courses }: { courses: TrackedCourse[] }) {
  const courseIds = useMemo(
    () => courses.filter((c) => c.status !== 'withdrawn').map((c) => c.id),
    [courses]
  );
  const { data, loading, error } = useAsyncData(
    () => Promise.all([fetchSchedules(courseIds), fetchAcademicEvents(courseIds)]),
    [courseIds.join(',')]
  );
  const [schedules, events] = data ?? [[], []];

  const days = useMemo(() => {
    const present = new Set(schedules.map((row) => row.dayOfWeek));
    return [...present].sort((a, b) => a - b);
  }, [schedules]);

  const upcoming = useMemo(
    () => events.filter((row) => new Date(row.startsAt).getTime() > Date.now()),
    [events]
  );

  if (loading) {
    return <div className="portal-empty" role="status"><Loader2 className="empty-icon" /> Loading your timetable…</div>;
  }
  if (error) return <p className="inline-notice is-error" role="alert">{error}</p>;

  return (
    <>
      <section className="platform-card">
        <div className="platform-card-head">
          <div>
            <h3>Weekly timetable</h3>
            <p className="platform-help">Published meeting times for the courses in your tracker.</p>
          </div>
        </div>
        {!courseIds.length ? (
          <div className="portal-empty"><p>Add courses to your tracker to see their scheduled meetings.</p></div>
        ) : schedules.length === 0 ? (
          <div className="portal-empty"><p>No meeting times have been published for your courses yet.</p></div>
        ) : (
          <div className="platform-list">
            {days.map((day) => (
              <div key={day}>
                <h4 className="platform-day-heading">{DAY_NAMES[day] ?? `Day ${day}`}</h4>
                <div className="platform-list">
                  {schedules
                    .filter((row) => row.dayOfWeek === day)
                    .map((row) => (
                      <article className="platform-list-item" key={row.id}>
                        <div className="platform-course-copy">
                          <strong>{row.courseCode} · {row.courseTitle}</strong>
                          <small>
                            {formatRange(row.startsAt, row.endsAt)}
                            {row.venue ? ` · ${row.venue}` : ''}
                            {row.lecturerName ? ` · ${row.lecturerName}` : ' · Lecturer not published'}
                          </small>
                        </div>
                        <div className="platform-list-meta">
                          <span className="platform-pill"><Clock size={13} /> {formatRange(row.startsAt, row.endsAt)}</span>
                        </div>
                      </article>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="platform-card">
        <div className="platform-card-head">
          <div>
            <h3>Tests &amp; examinations</h3>
            <p className="platform-help">Scheduled by FUW administrators for your tracked courses.</p>
          </div>
        </div>
        {upcoming.length === 0 ? (
          <div className="portal-empty"><p>No upcoming tests or examinations are scheduled.</p></div>
        ) : (
          <div className="platform-list">
            {upcoming.map((row: AcademicEvent) => (
              <article className="platform-list-item" key={row.id}>
                <div className="platform-course-copy">
                  <strong>{row.title}</strong>
                  <small>
                    {row.courseCode} · {formatDateTime(row.startsAt)}
                    {row.venue ? ` · ${row.venue}` : ''}
                    {row.endsAt ? ` · until ${formatDateTime(row.endsAt)}` : ''}
                  </small>
                  {row.notes && <small>{row.notes}</small>}
                </div>
                <div className="platform-list-meta">
                  <span className="platform-pill">
                    <CalendarDays size={13} /> {ACADEMIC_EVENT_TYPES.includes(row.eventType) ? row.eventType : 'test'}
                  </span>
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
/* Academic calendar                                                          */
/* -------------------------------------------------------------------------- */

export function CalendarPanel() {
  const { data, loading, error } = useAsyncData(fetchCalendarEntries, []);
  const entries = data ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.startsOn) ?? [];
      list.push(entry);
      map.set(entry.startsOn, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  if (loading) {
    return <div className="portal-empty" role="status"><Loader2 className="empty-icon" /> Loading the academic calendar…</div>;
  }
  if (error) return <p className="inline-notice is-error" role="alert">{error}</p>;
  if (!entries.length) {
    return <div className="portal-empty"><p>The academic calendar has not been published yet.</p></div>;
  }

  return (
    <section className="platform-card">
      <div className="platform-card-head">
        <div>
          <h3>Academic calendar</h3>
          <p className="platform-help">Published by the registrar. Draft entries are visible to administrators only.</p>
        </div>
      </div>
      <div className="platform-list">
        {grouped.map(([date, rows]) => (
          <article className="platform-list-item" key={date}>
            <div className="platform-course-copy">
              <strong>{formatDate(date)}</strong>
              {rows.map((row) => (
                <small key={row.id}>
                  <span className="platform-pill">{row.category}</span> {row.title}
                  {row.endsOn !== row.startsOn ? ` · until ${formatDate(row.endsOn)}` : ''}
                  {row.description ? ` · ${row.description}` : ''}
                </small>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Grades, GPA and calculator                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One line of the what-if calculator. Units and grade are held as the raw
 * text the student typed so the validation in `evaluateCalculatorRow` sees
 * exactly what was entered — a `type="number"` field or a `Number()` cast
 * would turn "abc" into 0 and quietly drop the course from the average.
 */
interface CalculatorRow extends CalculatorCourseInput {
  id: string;
}

let calculatorRowSequence = 0;
const newCalculatorRow = (): CalculatorRow => ({
  id: `cgpa-row-${calculatorRowSequence++}`,
  course: '',
  units: '',
  grade: ''
});

export function GradesPanel() {
  const { toast } = useToast();
  const grades = useAsyncData(fetchMyGrades, []);
  const gpa = useAsyncData(fetchMyGpa, []);
  const scale = useAsyncData(fetchDefaultGradingScale, []);
  const [rows, setRows] = useState<CalculatorRow[]>(() => [newCalculatorRow()]);
  // Toggled by "Calculate CGPA". The figures themselves are always derived
  // from the current rows, so a result can never go stale behind an edit.
  const [calculated, setCalculated] = useState(false);
  // Toggled once validation has actually been asked for, so incomplete rows
  // do not light up red the moment the panel opens.
  const [validated, setValidated] = useState(false);

  const published: StudentGrade[] = (grades.data ?? []).filter((row) => row.isPublished);
  const activeScale: GradingScale | null = scale.data ?? null;

  const evaluations = useMemo(
    () => rows.map((row) => evaluateCalculatorRow(row, activeScale)),
    [rows, activeScale]
  );
  const readyRows = evaluations.filter(
    (state): state is Extract<CalculatorRowState, { status: 'ready' }> => state.status === 'ready'
  );
  const invalidCount = evaluations.filter((state) => state.status === 'invalid').length;
  const blocked = invalidCount > 0;

  const cgpa = calculateCgpa(readyRows);
  const totalUnits = readyRows.reduce((sum, row) => sum + row.units, 0);
  const qualityPoints = readyRows.reduce((sum, row) => sum + row.qualityPoints, 0);
  // Nothing is shown until the student asks for it, and nothing is shown once
  // a row is invalid: a partial sum is worse than no sum.
  const showResult = calculated && !blocked && cgpa !== null;
  const cgpaText = showResult && cgpa !== null ? cgpa.toFixed(2) : null;

  const addRow = () => setRows((current) => [...current, newCalculatorRow()]);
  const removeRow = (index: number) =>
    setRows((current) => current.filter((_, i) => i !== index));
  const patchRow = (index: number, patch: Partial<CalculatorRow>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const handleCalculate = () => {
    setValidated(true);
    if (blocked) {
      toast(
        `Fix ${invalidCount} course ${invalidCount === 1 ? 'row' : 'rows'} before calculating.`,
        'error'
      );
      return;
    }
    if (cgpa === null) {
      toast('Add at least one course with credit units and a grade.', 'error');
      return;
    }
    setCalculated(true);
  };

  const handleReset = () => {
    setRows([newCalculatorRow()]);
    setValidated(false);
    setCalculated(false);
    toast('Calculator cleared.', 'info');
  };

  return (
    <>
      <section className="platform-card">
        <div className="platform-card-head">
          <div>
            <h3>Grade summary</h3>
            <p className="platform-help">Only published results count towards your GPA. Calculations are performed by the server.</p>
          </div>
        </div>
        {gpa.error && <p className="inline-notice is-error" role="alert">{gpa.error}</p>}
        {gpa.loading ? (
          <div className="portal-empty" role="status"><Loader2 className="empty-icon" /> Loading your GPA…</div>
        ) : (
          <div className="portal-stats">
            <section><Award /><b>{gpa.data?.cumulativeCgpa?.toFixed(2) ?? '-'}</b><span>Cumulative GPA</span></section>
            <section><Award /><b>{gpa.data?.currentSessionGpa?.toFixed(2) ?? '-'}</b><span>Session GPA</span></section>
            <section><Award /><b>{gpa.data?.totalUnits ?? 0}</b><span>Units counted</span></section>
            <section><Award /><b>{gpa.data?.coursesCounted ?? 0}</b><span>Graded courses</span></section>
          </div>
        )}
        {activeScale && (
          <p className="platform-help">
            Grading scale: <b>{activeScale.name}</b>
            {activeScale.isDefault ? ' (default)' : ''} ·{' '}
            {activeScale.bands.map((band) => `${band.letter} ${band.gradePoint}`).join(' · ')}
          </p>
        )}
      </section>

      <section className="platform-card">
        <div className="platform-card-head">
          <div>
            <h3>Published results</h3>
            <p className="platform-help">Recorded by FUW administrators. Unpublished results are hidden from you until the university publishes them.</p>
          </div>
        </div>
        {grades.error && <p className="inline-notice is-error" role="alert">{grades.error}</p>}
        {grades.loading ? (
          <div className="portal-empty" role="status"><Loader2 className="empty-icon" /> Loading results…</div>
        ) : published.length === 0 ? (
          <div className="portal-empty"><p>No results have been published for you yet.</p></div>
        ) : (
          <div className="table-scroll-wrapper">
            <table className="admin-table">
              <thead>
                <tr><th>Course</th><th>Units</th><th>Grade</th><th>Point</th><th>Session</th></tr>
              </thead>
              <tbody>
                {published.map((row) => (
                  <tr key={row.id}>
                    <td className="cell-bold">{row.courseCode}</td>
                    <td>{row.units ?? '-'}</td>
                    <td><span className="status-badge completed">{row.gradeLetter}</span></td>
                    <td>{row.gradePoint.toFixed(2)}</td>
                    <td className="cell-secondary">{row.sessionName ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="platform-card">
        <div className="platform-card-head">
          <div>
            <h3>CGPA calculator</h3>
            <p className="platform-help">
              What-if estimate on the {activeScale?.name ?? 'default'} scale: CGPA = Σ(grade
              point × credit units) ÷ Σ(credit units). Nothing here is saved or recorded.
            </p>
          </div>
          <button type="button" className="secondary-btn" onClick={addRow}><Plus size={15} /> Add course</button>
        </div>
        {!activeScale ? (
          <div className="portal-empty">
            <p>No grading scale is published, so scores cannot be mapped to grade points yet.</p>
          </div>
        ) : (
          <>
            {rows.length === 0 ? (
              <div className="portal-empty">
                <p>No courses added yet. Add the first course of your what-if semester.</p>
                <button type="button" className="secondary-btn" onClick={addRow}>
                  <Plus size={15} /> Add your first course
                </button>
              </div>
            ) : (
              <div className="platform-list">
                {rows.map((row, index) => {
                  const state = evaluations[index];
                  const invalid = validated && state.status === 'invalid';
                  const unitsInvalid = invalid && state.status === 'invalid' && state.field === 'units';
                  const gradeInvalid = invalid && state.status === 'invalid' && state.field === 'grade';
                  const errorId = `cgpa-error-${row.id}`;
                  const band = row.grade
                    ? activeScale.bands.find((entry) => entry.letter === row.grade) ?? null
                    : null;
                  return (
                    <div
                      key={row.id}
                      className="platform-list-item"
                      style={{
                        display: 'block',
                        position: 'relative',
                        paddingRight: 46,
                        ...(invalid ? { background: '#fef2f2', borderColor: '#f5c6c6' } : null)
                      }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 12px', alignItems: 'flex-end' }}>
                        <div className="platform-field" style={{ flex: '2 1 220px', minWidth: 0 }}>
                          <label htmlFor={`cgpa-course-${row.id}`}>Course name or code</label>
                          <input
                            id={`cgpa-course-${row.id}`}
                            className="form-input"
                            type="text"
                            autoComplete="off"
                            placeholder="e.g. GST 101 · Technical English"
                            value={row.course}
                            onChange={(event) => patchRow(index, { course: event.target.value })}
                          />
                        </div>

                        <div className="platform-field" style={{ flex: '1 1 130px', minWidth: 0 }}>
                          <label htmlFor={`cgpa-units-${row.id}`}>Credit units</label>
                          <input
                            id={`cgpa-units-${row.id}`}
                            className="form-input"
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="e.g. 3"
                            value={row.units}
                            onChange={(event) => patchRow(index, { units: event.target.value })}
                            aria-invalid={unitsInvalid || undefined}
                            aria-describedby={unitsInvalid ? errorId : undefined}
                          />
                        </div>

                        <div className="platform-field" style={{ flex: '1 1 150px', minWidth: 0 }}>
                          <label htmlFor={`cgpa-grade-${row.id}`}>Grade</label>
                          <select
                            id={`cgpa-grade-${row.id}`}
                            className="form-select"
                            value={row.grade}
                            onChange={(event) => patchRow(index, { grade: event.target.value })}
                            aria-invalid={gradeInvalid || undefined}
                            aria-describedby={gradeInvalid ? errorId : undefined}
                          >
                            <option value="">Select grade</option>
                            {activeScale.bands.map((entry) => (
                              <option key={entry.letter} value={entry.letter}>
                                {entry.letter} · {entry.gradePoint.toFixed(2)} pts
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="platform-field" style={{ flex: '1 1 120px', minWidth: 0 }}>
                          <label htmlFor={`cgpa-point-${row.id}`}>Grade point</label>
                          <input
                            id={`cgpa-point-${row.id}`}
                            className="form-input"
                            type="text"
                            readOnly
                            aria-readonly="true"
                            placeholder="-"
                            value={band ? band.gradePoint.toFixed(2) : ''}
                            onFocus={(event) => event.currentTarget.select()}
                          />
                        </div>
                      </div>

                      {invalid && state.status === 'invalid' && (
                        <p id={errorId} role="alert" className="inline-notice is-error" style={{ margin: '10px 0 0' }}>
                          {state.message}
                        </p>
                      )}

                      <button
                        type="button"
                        className="planner-icon-btn danger"
                        aria-label={`Remove ${row.course.trim() || `course ${index + 1}`}`}
                        onClick={() => removeRow(index)}
                        style={{ position: 'absolute', top: 12, right: 12 }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {validated && invalidCount > 0 && (
              <p className="inline-notice is-error" role="alert" style={{ margin: '16px 0 0' }}>
                {invalidCount} course {invalidCount === 1 ? 'row needs' : 'rows need'} attention.
                Fix the highlighted fields before calculating.
              </p>
            )}

            <div className="portal-stats" style={{ margin: '18px 0 0' }} aria-live="polite">
              <section>
                <GraduationCap />
                <b>{cgpaText ?? '-'}</b>
                <span>Projected CGPA</span>
              </section>
              <section>
                <BookOpen />
                <b>{showResult ? totalUnits : '-'}</b>
                <span>Total credit units</span>
              </section>
              <section>
                <Award />
                <b>{showResult ? qualityPoints.toFixed(2) : '-'}</b>
                <span>Quality points</span>
              </section>
              <section>
                <Check />
                <b>{showResult ? readyRows.length : '-'}</b>
                <span>Courses counted</span>
              </section>
            </div>

            <p className="platform-help" style={{ margin: '10px 0 0' }}>
              {showResult
                ? `${readyRows.length} course${readyRows.length === 1 ? '' : 's'} · ${totalUnits} credit unit${totalUnits === 1 ? '' : 's'} counted on the ${activeScale.name} scale.`
                : 'Enter every course with its credit units and grade, then choose Calculate CGPA. Rows that are incomplete or out of range are never counted.'}
            </p>

            <div className="platform-form-actions" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
              <button type="button" className="primary" onClick={handleCalculate}>
                <Calculator size={15} /> Calculate CGPA
              </button>
              <button type="button" className="secondary-btn" onClick={handleReset}>
                <RotateCcw size={15} /> Reset
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Course workspace                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Everything the platform knows about one course, in one place: who teaches it,
 * when it meets, what is scheduled against it, and the related library material.
 * Official fields come from admin-managed tables; the material list is the
 * existing E-Library catalogue filtered by course code.
 */
export function CourseWorkspace({ courses }: { courses: TrackedCourse[] }) {
  const active = courses.filter((course) => course.status !== 'withdrawn');
  const [courseId, setCourseId] = useState(active[0]?.id ?? '');
  const course = active.find((row) => row.id === courseId) ?? active[0] ?? null;

  const workspace = useAsyncData(async () => {
    if (!course) return null;
    const [allocations, schedules, events] = await Promise.all([
      fetchCourseLecturers(course.id),
      fetchSchedules([course.id]),
      fetchAcademicEvents([course.id])
    ]);
    return { allocations, schedules, events };
  }, [course?.id]);

  const materials = useAsyncData(
    () => (course ? fetchMaterials({ courseCode: course.code, status: 'approved' }, {}, 0, 6) : Promise.resolve(null)),
    [course?.code]
  );

  if (!course) {
    return (
      <div className="portal-empty">
        <p>Add a course to your tracker to open its workspace.</p>
      </div>
    );
  }

  const { allocations, schedules, events } = workspace.data ?? {
    allocations: [],
    schedules: [],
    events: []
  };
  const upcoming = events.filter((row) => new Date(row.startsAt).getTime() > Date.now());

  return (
    <>
      <section className="platform-card">
        <div className="platform-card-head">
          <div>
            <h3>Course workspace</h3>
            <p className="platform-help">Official records and library material for a single course.</p>
          </div>
          <label className="campus-search">
            <select value={course.id} onChange={(event) => setCourseId(event.target.value)} aria-label="Choose a course">
              {active.map((row) => (
                <option key={row.trackerId} value={row.id}>{row.code} · {row.title}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="platform-help">
          <strong>{course.code} · {course.title}</strong> · {course.units ?? '-'} units · {course.level} ·{' '}
          {course.semester}{course.sessionName ? ` · ${course.sessionName}` : ''}
        </p>
      </section>

      <section className="platform-card">
        <div className="platform-card-head"><h3>Lecturers</h3></div>
        {workspace.loading ? (
          <Busy label="Loading course records…" />
        ) : allocations.length === 0 ? (
          <div className="portal-empty">
            <p>No lecturer has been published for this course. The platform does not guess names.</p>
          </div>
        ) : (
          <div className="platform-list">
            {allocations.map((row) => (
              <article className="platform-list-item" key={row.id}>
                <div className="platform-course-copy">
                  <strong>{row.lecturerName ?? 'Unknown lecturer'}</strong>
                  <small>{row.isPrimary ? 'Primary lecturer' : 'Lecturer'}{row.sessionName ? ` · ${row.sessionName}` : ''}</small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="platform-card">
        <div className="platform-card-head"><h3>Meetings &amp; assessments</h3></div>
        {schedules.length === 0 && upcoming.length === 0 ? (
          <div className="portal-empty"><p>Nothing has been scheduled for this course yet.</p></div>
        ) : (
          <div className="platform-list">
            {schedules.map((row) => (
              <article className="platform-list-item" key={`s-${row.id}`}>
                <div className="platform-course-copy">
                  <strong>{DAY_NAMES[row.dayOfWeek]} · {formatRange(row.startsAt, row.endsAt)}</strong>
                  <small>{row.venue || 'Venue not published'}{row.lecturerName ? ` · ${row.lecturerName}` : ''}</small>
                </div>
              </article>
            ))}
            {upcoming.map((row) => (
              <article className="platform-list-item" key={`e-${row.id}`}>
                <div className="platform-course-copy">
                  <strong>{row.title}</strong>
                  <small>{formatDateTime(row.startsAt)}{row.venue ? ` · ${row.venue}` : ''}</small>
                </div>
                <div className="platform-list-meta">
                  <span className="platform-pill">
                    <CalendarDays size={13} /> {row.eventType === 'test' ? 'Test' : 'Examination'}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="platform-card">
        <div className="platform-card-head">
          <div>
            <h3>Related library material</h3>
            <p className="platform-help">Approved E-Library material tagged with {course.code}.</p>
          </div>
          <Link className="secondary-btn" to={`/library?course=${encodeURIComponent(course.code)}`}>
            <ExternalLink size={15} /> Open in the library
          </Link>
        </div>
        {materials.loading ? (
          <Busy label="Loading library material…" />
        ) : !materials.data || materials.data.items.length === 0 ? (
          <div className="portal-empty"><p>No approved library material is tagged with {course.code} yet.</p></div>
        ) : (
          <div className="platform-grid">
            {materials.data.items.map((item) => (
              <article className="platform-tile" key={item.id}>
                <div className="platform-tile-top">
                  <strong>{item.type}</strong>
                  <span className="status-badge">{item.downloads} downloads</span>
                </div>
                <h4>{item.title}</h4>
                <p>{item.level} · {item.semester}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Reminder preferences                                                       */
/* -------------------------------------------------------------------------- */

export function AcademicsReminderHint() {
  return (
    <p className="platform-disclaimer">
      <AlarmClock size={13} /> Assignment and examination reminders respect your notification settings.
      Mute the academic category in Notifications to stop them; reminders stay pending and resume if you re-enable it.
    </p>
  );
}
