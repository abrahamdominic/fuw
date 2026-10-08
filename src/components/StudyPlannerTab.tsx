// StudyPlannerTab — per-user study plan with progress tracking.
// Backed by the study_planner_tasks table (see 20260917_study_social_security.sql).
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarRange,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  PlayCircle,
  Pencil,
  X,
  Flag,
  AlertTriangle,
  Sparkles,
  Loader2
} from 'lucide-react';
import { fx, staggerDelay } from '../lib/motion';
import {
  fetchPlannerTasks,
  createPlannerTask,
  updatePlannerTask,
  deletePlannerTask,
  plannerStats,
  sortPlannerTasks,
  generateAiPlannerTasks,
  type PlannerTask,
  type PlannerTaskInput,
  type PlannerTaskType,
  type PlannerPriority
} from '../lib/planner';
import { useToast } from './Toast';
import { requireSupabase } from '../lib/supabase';

const TASK_TYPES: { value: PlannerTaskType; label: string }[] = [
  { value: 'study', label: 'Study' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'exam_prep', label: 'Exam prep' },
  { value: 'revision', label: 'Revision' },
  { value: 'other', label: 'Other' }
];

const PRIORITIES: { value: PlannerPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' }
];

function formatDue(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  const diffDays = Math.round((t.getTime() - today.getTime()) / 86400000);
  const label = d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  if (diffDays < 0) return `${label} · overdue`;
  if (diffDays === 0) return `${label} · today`;
  if (diffDays === 1) return `${label} · tomorrow`;
  return label;
}

const EMPTY_FORM: PlannerTaskInput = {
  title: '',
  description: '',
  courseCode: '',
  taskType: 'study',
  priority: 'normal',
  status: 'pending',
  dueDate: ''
};

export function StudyPlannerTab() {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PlannerTaskInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [advancedPlansEnabled, setAdvancedPlansEnabled] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // AI Plan Generator state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiCourse, setAiCourse] = useState('');
  const [aiGoal, setAiGoal] = useState('');
  const [aiDays, setAiDays] = useState(7);
  const [aiHours, setAiHours] = useState(2);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGeneratedTasks, setAiGeneratedTasks] = useState<{ task: PlannerTaskInput; selected: boolean }[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);

  const handleGenerateAiTasks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiCourse.trim() || !aiGoal.trim()) return;
    if (!advancedPlansEnabled) {
      setAiError('AI-Assisted Study Planning is a Premium feature. Please upgrade to unlock.');
      return;
    }
    setAiGenerating(true);
    setAiError(null);
    try {
      const generated = await generateAiPlannerTasks({
        courseCode: aiCourse,
        goal: aiGoal,
        daysAvailable: aiDays,
        hoursPerDay: aiHours
      });
      if (generated.length === 0) {
        throw new Error('No tasks could be generated. Please refine your goal.');
      }
      setAiGeneratedTasks(generated.map((task) => ({ task, selected: true })));
    } catch (err: any) {
      setAiError(err?.message || 'Failed to generate plan.');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAcceptAiTasks = async () => {
    const selected = aiGeneratedTasks.filter((t) => t.selected).map((t) => t.task);
    if (selected.length === 0) return;
    setSaving(true);
    try {
      for (const t of selected) {
        await createPlannerTask(t);
      }
      toast(`Added ${selected.length} AI study tasks to your planner.`, 'success');
      setShowAiModal(false);
      setAiGeneratedTasks([]);
      setAiCourse('');
      setAiGoal('');
      await load();
    } catch {
      toast('Could not add some tasks. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [items, featureResult] = await Promise.all([
        fetchPlannerTasks(),
        requireSupabase().rpc('has_premium_feature', { p_feature_key: 'advanced_study_plans' })
      ]);
      if (featureResult.error) throw new Error(featureResult.error.message);
      setTasks(items);
      setAdvancedPlansEnabled(featureResult.data === true);
      setLoadError(null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not verify study-planner access.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = plannerStats(tasks);

  const openAddForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEditForm = (t: PlannerTask) => {
    setEditingId(t.id);
    setForm({
      title: t.title,
      description: t.description,
      courseCode: t.courseCode ?? '',
      taskType: t.taskType,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate ? t.dueDate.slice(0, 10) : ''
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast('Please enter a title for the task.', 'error');
      return;
    }
    if (form.taskType === 'exam_prep' && !advancedPlansEnabled) {
      toast('Premium access is required for advanced exam-preparation tasks.', 'error');
      return;
    }
    setSaving(true);
    const payload: PlannerTaskInput = {
      ...form,
      title: form.title.trim(),
      courseCode: form.courseCode?.trim() || null,
      dueDate: form.dueDate || null
    };
    if (editingId) {
      const ok = await updatePlannerTask(editingId, payload);
      if (ok) toast('Task updated.', 'success');
      else toast('Could not update the task. Please try again.', 'error');
    } else {
      const created = await createPlannerTask(payload);
      if (created) toast('Task added to your study plan.', 'success');
      else toast('Could not add the task. Please try again.', 'error');
    }
    setSaving(false);
    setShowForm(false);
    await load();
  };

  const handleSetStatus = async (id: string, status: PlannerTask['status']) => {
    const prev = tasks;
    setTasks((cur) =>
      sortPlannerTasks(
        cur.map((t) => (t.id === id ? { ...t, status, completedAt: status === 'completed' ? new Date().toISOString() : null } : t))
      )
    );
    const ok = await updatePlannerTask(id, { status });
    if (!ok) {
      setTasks(prev);
      toast('Could not update the task. Please try again.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await deletePlannerTask(id);
    if (ok) {
      setTasks((cur) => cur.filter((t) => t.id !== id));
      toast('Task removed from your study plan.', 'info');
    } else {
      toast('Could not remove the task. Please try again.', 'error');
    }
  };

  const visibleTasks = tasks.filter((t) => (filter === 'all' ? true : t.status === filter));

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">STUDY PLANNER</p>
          <h1>Plan your study sessions</h1>
          <p className="subtitle">
            Break your courses into focused tasks, set priorities, and track progress.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setShowAiModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Sparkles size={15} color="#9333ea" />
            <span>AI Auto-Plan</span>
          </button>
          {!showForm ? (
            <button type="button" className="primary" onClick={openAddForm}>
              <Plus size={16} />
              <span>Add task</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Progress overview */}
      <div className="upload-stats-row">
        <div className="upload-stat-card">
          <b>{stats.total}</b>
          <span>Total tasks</span>
        </div>
        <div className="upload-stat-card">
          <b>{stats.inProgress}</b>
          <span>In progress</span>
        </div>
        <div className="upload-stat-card ok">
          <b>{stats.completed}</b>
          <span>Completed</span>
        </div>
        <div className="upload-stat-card warn">
          <b>{stats.overdue}</b>
          <span>Overdue</span>
        </div>
        <div className="upload-stat-card ok">
          <b>{stats.completionRate}%</b>
          <span>Completion rate</span>
        </div>
      </div>

      {loading ? (
        <div className="portal-empty">Loading your study plan…</div>
      ) : loadError ? (
        <p className="inline-notice is-error" role="alert">{loadError}</p>
      ) : !showForm && tasks.length === 0 ? (
        <div className="portal-empty">
          <CalendarRange size={34} className="empty-icon" />
          <p>Your study plan is empty.</p>
          <button type="button" className="secondary-btn" onClick={openAddForm}>
            <Plus size={15} /> Create your first task
          </button>
        </div>
      ) : null}

      {/* Add / edit task form */}
      {showForm && (
        <form className="planner-form" onSubmit={handleSubmit}>
          <div className="planner-form-head">
            <h3>{editingId ? 'Edit task' : 'Add a study task'}</h3>
            <button type="button" className="planner-form-close" onClick={() => setShowForm(false)} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="planner-form-grid">
            <label className="planner-field planner-field-wide">
              <span>Task title</span>
              <input
                type="text"
                value={form.title ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Review Chapter 4 – Electrochemistry"
                autoFocus
                maxLength={200}
              />
            </label>
            <label className="planner-field">
              <span>Course code</span>
              <input
                type="text"
                value={form.courseCode ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, courseCode: e.target.value }))}
                placeholder="e.g. CHM 201"
                maxLength={30}
              />
            </label>
            <label className="planner-field">
              <span>Type</span>
              <select
                value={form.taskType}
                onChange={(e) => setForm((f) => ({ ...f, taskType: e.target.value as PlannerTaskType }))}
              >
                {TASK_TYPES.map((t) => (
                  <option key={t.value} value={t.value} disabled={t.value === 'exam_prep' && !advancedPlansEnabled}>
                    {t.label}{t.value === 'exam_prep' && !advancedPlansEnabled ? ' (Premium)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="planner-field">
              <span>Priority</span>
              <select
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as PlannerPriority }))}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="planner-field">
              <span>Due date</span>
              <input
                type="date"
                value={form.dueDate ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </label>
            <label className="planner-field planner-field-wide">
              <span>Notes</span>
              <input
                type="text"
                value={form.description ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional note, chapter range, or reminder"
                maxLength={500}
              />
            </label>
          </div>
          {!advancedPlansEnabled && (
            <p className="planner-premium-hint">
              Advanced exam-preparation tasks require <Link to="/student/subscription">Premium access</Link>.
            </p>
          )}
          <div className="planner-form-actions">
            <button type="button" className="secondary-btn" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add task'}
            </button>
          </div>
        </form>
      )}

      {/* Filter pills */}
      {tasks.length > 0 && (
        <div className="planner-filter-row">
          {(['all', 'pending', 'in_progress', 'completed'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`planner-filter-pill ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f.replace('_', ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Task list */}
      {visibleTasks.length > 0 && (
        <div className="planner-list">
          {visibleTasks.map((task, taskIndex) => {
            const isDone = task.status === 'completed';
            const requiresPremium = task.taskType === 'exam_prep' && !advancedPlansEnabled;
            const overdue = task.status !== 'completed' && task.status !== 'skipped' && !!task.dueDate && new Date(task.dueDate).getTime() < Date.now();
            return (
              <div
                key={task.id}
                style={staggerDelay(taskIndex, 30)}
                className={`planner-item ${fx.listRow} ${isDone ? 'done' : ''} ${task.status === 'in_progress' ? 'focus' : ''}`}
              >
                <button
                  type="button"
                  className="planner-item-toggle"
                  disabled={requiresPremium}
                  onClick={() =>
                    handleSetStatus(task.id, isDone ? 'pending' : task.status === 'in_progress' ? 'completed' : 'in_progress')
                  }
                  aria-label={isDone ? 'Mark as not done' : 'Advance status'}
                  title={requiresPremium ? 'Premium access is required to update this exam-prep task' : isDone ? 'Mark as pending' : 'Advance status'}
                >
                  {isDone ? <CheckCircle2 size={20} /> : task.status === 'in_progress' ? <PlayCircle size={20} /> : <Circle size={20} />}
                </button>
                <div className="planner-item-body">
                  <div className="planner-item-title-row">
                    <b className="planner-item-title">{task.title}</b>
                    {overdue && (
                      <span className="planner-badge-bad">
                        <AlertTriangle size={11} /> Overdue
                      </span>
                    )}
                    <span className="planner-badge neutral">{task.taskType.replace('_', ' ')}</span>
                    {requiresPremium && <Link className="planner-premium-link" to="/student/subscription">Premium required</Link>}
                    {task.priority !== 'normal' && (
                      <span className={`planner-badge prio-${task.priority}`}>
                        <Flag size={11} /> {task.priority}
                      </span>
                    )}
                  </div>
                  {(task.description || task.courseCode) && (
                    <p className="planner-item-desc">
                      {[task.courseCode, task.description].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="planner-item-right">
                  {task.dueDate && (
                    <span className={`planner-due ${overdue ? 'overdue' : ''}`}>{formatDue(task.dueDate)}</span>
                  )}
                  <button type="button" className="planner-icon-btn" onClick={() => openEditForm(task)} aria-label="Edit task">
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    className="planner-icon-btn danger"
                    onClick={() => handleDelete(task.id)}
                    aria-label="Delete task"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !showForm && tasks.length > 0 && visibleTasks.length === 0 && (
        <div className="portal-empty">
          <p>No tasks in this section.</p>
        </div>
      )}

      {/* Modal: AI Auto-Plan */}
      {showAiModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, maxWidth: 520, width: '100%', padding: 24, boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} color="#9333ea" />
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>AI Study Task Planner</h3>
              </div>
              <button type="button" onClick={() => setShowAiModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {aiError && (
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', fontSize: 12, marginBottom: 14 }}>
                {aiError}
              </div>
            )}

            {aiGeneratedTasks.length === 0 ? (
              <form onSubmit={handleGenerateAiTasks} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Course Code:</label>
                  <input
                    type="text"
                    required
                    value={aiCourse}
                    onChange={(e) => setAiCourse(e.target.value.toUpperCase())}
                    placeholder="e.g. CSC 201, MTH 101, CHM 101"
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Study Goal:</label>
                  <input
                    type="text"
                    required
                    value={aiGoal}
                    onChange={(e) => setAiGoal(e.target.value)}
                    placeholder="e.g. Catch up on mid-semester topics, prepare for upcoming exam"
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Plan Duration:</label>
                    <select
                      value={aiDays}
                      onChange={(e) => setAiDays(Number(e.target.value))}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                    >
                      <option value={3}>3 Days</option>
                      <option value={7}>7 Days (1 Week)</option>
                      <option value={14}>14 Days (2 Weeks)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Daily Study Hours:</label>
                    <select
                      value={aiHours}
                      onChange={(e) => setAiHours(Number(e.target.value))}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                    >
                      <option value={1}>1 hour / day</option>
                      <option value={2}>2 hours / day</option>
                      <option value={4}>4 hours / day</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAiModal(false)} style={{ fontSize: 13 }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={aiGenerating} style={{ fontSize: 13 }}>
                    {aiGenerating ? <><Loader2 size={14} className="spin-icon" /> Generating Tasks...</> : 'Generate Tasks'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  Review and select the tasks you would like to add to your plan:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', marginBottom: 16 }}>
                  {aiGeneratedTasks.map((item, idx) => (
                    <label
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: 'var(--surface-alt)',
                        border: '1px solid var(--border)',
                        cursor: 'pointer'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setAiGeneratedTasks((prev) =>
                            prev.map((t, i) => (i === idx ? { ...t, selected: val } : t))
                          );
                        }}
                        style={{ marginTop: 3 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{item.task.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {item.task.description || item.task.courseCode} · Due: {item.task.dueDate}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setAiGeneratedTasks([])}
                    style={{ fontSize: 12 }}
                  >
                    Back / Regenerate
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleAcceptAiTasks}
                    disabled={saving || !aiGeneratedTasks.some((t) => t.selected)}
                    style={{ fontSize: 13 }}
                  >
                    {saving ? 'Adding...' : 'Add Selected to Study Plan'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}