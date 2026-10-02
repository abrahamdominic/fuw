// StudyPlannerTab — per-user study plan with progress tracking.
// Backed by the study_planner_tasks table (see 20260917_study_social_security.sql).
import React, { useCallback, useEffect, useState } from 'react';
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
  AlertTriangle
} from 'lucide-react';
import { fx, staggerDelay } from '../lib/motion';
import {
  fetchPlannerTasks,
  createPlannerTask,
  updatePlannerTask,
  deletePlannerTask,
  plannerStats,
  sortPlannerTasks,
  type PlannerTask,
  type PlannerTaskInput,
  type PlannerTaskType,
  type PlannerPriority
} from '../lib/planner';
import { useToast } from './Toast';

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

  const load = useCallback(async () => {
    const items = await fetchPlannerTasks();
    setTasks(items);
    setLoading(false);
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
        {!showForm ? (
          <button type="button" className="primary" onClick={openAddForm}>
            <Plus size={16} />
            <span>Add task</span>
          </button>
        ) : null}
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
                  <option key={t.value} value={t.value}>
                    {t.label}
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
                  onClick={() =>
                    handleSetStatus(task.id, isDone ? 'pending' : task.status === 'in_progress' ? 'completed' : 'in_progress')
                  }
                  aria-label={isDone ? 'Mark as not done' : 'Advance status'}
                  title={isDone ? 'Mark as pending' : 'Advance status'}
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
    </div>
  );
}