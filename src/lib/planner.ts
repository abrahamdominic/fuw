// Study Planner data-access layer (table: study_planner_tasks).
// All reads/writes go through RLS-protected queries scoped to the signed-in user.
import { supabase } from './supabase';

export type PlannerTaskType = 'study' | 'assignment' | 'exam_prep' | 'revision' | 'other';
export type PlannerPriority = 'low' | 'normal' | 'high' | 'urgent';
export type PlannerStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface PlannerTask {
  id: string;
  title: string;
  description: string;
  courseCode?: string | null;
  materialId?: string | null;
  taskType: PlannerTaskType;
  priority: PlannerPriority;
  status: PlannerStatus;
  dueDate?: string | null;
  completedAt?: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlannerTaskInput {
  title: string;
  description?: string;
  courseCode?: string | null;
  materialId?: string | null;
  taskType?: PlannerTaskType;
  priority?: PlannerPriority;
  status?: PlannerStatus;
  dueDate?: string | null;
  position?: number;
}

const STATUS_ORDER: Record<PlannerStatus, number> = {
  completed: 3,
  skipped: 4,
  in_progress: 1,
  pending: 0
};
const PRIORITY_ORDER: Record<PlannerPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export function sortPlannerTasks(tasks: PlannerTask[]): PlannerTask[] {
  return [...tasks].sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (b.status === 'completed' && a.status !== 'completed') return -1;
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    const p = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    if (p !== 0) return p;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function mapRow(row: any): PlannerTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    courseCode: row.course_code ?? null,
    materialId: row.material_id ?? null,
    taskType: (row.task_type as PlannerTaskType) || 'study',
    priority: (row.priority as PlannerPriority) || 'normal',
    status: (row.status as PlannerStatus) || 'pending',
    dueDate: row.due_date ?? null,
    completedAt: row.completed_at ?? null,
    position: row.position ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function fetchPlannerTasks(): Promise<PlannerTask[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('study_planner_tasks')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) return [];
  return sortPlannerTasks((data ?? []).map(mapRow));
}

export async function createPlannerTask(input: PlannerTaskInput): Promise<PlannerTask | null> {
  if (!supabase) return null;
  // study_planner_tasks.user_id is NOT NULL (RLS scopes rows to the owner), so
  // the owning auth user must be attached explicitly or the insert is rejected.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('study_planner_tasks')
    .insert({
      user_id: user.id,
      title: input.title,
      description: input.description || '',
      course_code: input.courseCode ?? null,
      material_id: input.materialId ?? null,
      task_type: input.taskType || 'study',
      priority: input.priority || 'normal',
      status: input.status || 'pending',
      due_date: input.dueDate ?? null,
      position: input.position ?? 0
    })
    .select()
    .single();
  if (error) return null;
  return mapRow(data);
}

export async function updatePlannerTask(
  id: string,
  patch: Partial<PlannerTaskInput>
): Promise<boolean> {
  if (!supabase) return false;
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.courseCode !== undefined) row.course_code = patch.courseCode;
  if (patch.materialId !== undefined) row.material_id = patch.materialId;
  if (patch.taskType !== undefined) row.task_type = patch.taskType;
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
  if (patch.position !== undefined) row.position = patch.position;
  const { error } = await supabase.from('study_planner_tasks').update(row).eq('id', id);
  return !error;
}

export async function deletePlannerTask(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('study_planner_tasks').delete().eq('id', id);
  return !error;
}

export function plannerStats(tasks: PlannerTask[]): {
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  completionRate: number;
} {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = tasks.filter((t) => {
    if (t.status === 'completed' || t.status === 'skipped') return false;
    if (!t.dueDate) return false;
    const due = new Date(t.dueDate);
    due.setHours(0, 0, 0, 0);
    return due.getTime() < today.getTime();
  }).length;
  return {
    total,
    completed,
    inProgress,
    overdue,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100)
  };
}