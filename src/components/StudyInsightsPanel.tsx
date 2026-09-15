import React, { useEffect, useState } from 'react';
import { useStore } from '../lib/useStore';
import { fetchPlannerTasks, plannerStats, PlannerTask } from '../lib/planner';
import { fetchStudentNotes } from '../lib/notes';

interface StudyInsights {
  loading: boolean;
  tasks: PlannerTask[];
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  completionRate: number;
  notesCount: number;
  readingCount7d: number;
  dueSoon: PlannerTask[];
}

const emptyInsights: StudyInsights = {
  loading: true,
  tasks: [],
  totalTasks: 0,
  completedTasks: 0,
  overdueTasks: 0,
  completionRate: 0,
  notesCount: 0,
  readingCount7d: 0,
  dueSoon: []
};

export function StudyInsightsPanel() {
  const store = useStore();
  const [insights, setInsights] = useState<StudyInsights>(emptyInsights);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setInsights((prev) => ({ ...prev, loading: true }));
      try {
        const [tasks, notes, reading] = await Promise.all([
          fetchPlannerTasks().catch(() => [] as PlannerTask[]),
          fetchStudentNotes().catch(() => []),
          Promise.resolve(store.getReadingHistory())
        ]);
        if (cancelled) return;
        const stats = plannerStats(tasks);
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const readingCount7d = reading.filter((r) => {
          const ts = typeof r.lastReadAt === 'string' ? new Date(r.lastReadAt).getTime() : r.lastReadAt;
          return typeof ts === 'number' && ts >= weekAgo;
        }).length;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dueSoon = tasks
          .filter((t) => t.status !== 'completed' && t.status !== 'skipped' && t.dueDate)
          .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
          .slice(0, 3);
        setInsights({
          loading: false,
          tasks,
          totalTasks: stats.total,
          completedTasks: stats.completed,
          overdueTasks: stats.overdue,
          completionRate: stats.completionRate,
          notesCount: notes.length,
          readingCount7d,
          dueSoon
        });
      } catch {
        if (!cancelled) setInsights((prev) => ({ ...prev, loading: false }));
      }
    }
    void load();
    const unsubscribe = store.subscribe(() => {
      const reading = store.getReadingHistory();
      setInsights((prev) => ({ ...prev, readingCount7d: reading.filter((r) => {
        const ts = typeof r.lastReadAt === 'string' ? new Date(r.lastReadAt).getTime() : r.lastReadAt;
        return typeof ts === 'number' && ts >= Date.now() - 7 * 24 * 60 * 60 * 1000;
      }).length }));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [store]);

  if (insights.loading) return null;
  if (insights.totalTasks === 0 && insights.notesCount === 0 && insights.readingCount7d === 0) return null;

  return (
    <section className="card study-insights">
      <div className="card-header">
        <h3 className="card-title">Study insights</h3>
        <span className="study-insights-sub">Your learning snapshot</span>
      </div>
      <div className="study-insight-stats">
        <div className="study-insight-stat">
          <span className="study-insight-value">{insights.completionRate}%</span>
          <span className="study-insight-label">Planner completion</span>
        </div>
        <div className="study-insight-stat">
          <span className="study-insight-value">{insights.overdueTasks}</span>
          <span className="study-insight-label">Overdue tasks</span>
        </div>
        <div className="study-insight-stat">
          <span className="study-insight-value">{insights.notesCount}</span>
          <span className="study-insight-label">Notes written</span>
        </div>
        <div className="study-insight-stat">
          <span className="study-insight-value">{insights.readingCount7d}</span>
          <span className="study-insight-label">Materials read (7 days)</span>
        </div>
      </div>
      {insights.dueSoon.length > 0 && (
        <div className="study-due-list">
          <div className="study-due-heading">Coming up</div>
          {insights.dueSoon.map((t) => (
            <div className="study-due-item" key={t.id}>
              <span className="study-due-title">{t.title}</span>
              <span className={t.status === 'in_progress' ? 'study-due-badge in-progress' : 'study-due-badge'}>
                {t.status === 'in_progress' ? 'In progress' : new Date(t.dueDate!).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}