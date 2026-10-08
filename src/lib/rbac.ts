// Role-based access control constants shared across the app.
// These MUST stay in sync with the `app_role` enum and permission arrays
// defined in supabase/migrations (see is_admin()/has_permission() SQL).

export type AppRole = 'student' | 'lecturer' | 'admin' | 'super_admin';

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
}

export const ALL_PERMISSIONS: PermissionDef[] = [
  {
    key: 'approve_materials',
    label: 'Approve materials',
    description: 'Review and approve pending student submissions.'
  },
  {
    key: 'reject_materials',
    label: 'Reject materials',
    description: 'Reject pending submissions with a reason sent to the uploader.'
  },
  {
    key: 'delete_any_material',
    label: 'Delete any material',
    description: 'Remove any material from the library, including approved ones.'
  },
  {
    key: 'upload_as_approved',
    label: 'Publish instantly',
    description: 'Uploaded materials are published immediately without review.'
  },
  {
    key: 'manage_students',
    label: 'Manage students',
    description: 'View student accounts and deactivate abusive accounts.'
  },
  {
    key: 'manage_catalogue',
    label: 'Manage catalogue',
    description: 'Edit faculties, departments, courses and levels metadata.'
  },
  {
    key: 'view_analytics',
    label: 'View analytics',
    description: 'See library-wide statistics and download trends.'
  },
  {
    key: 'manage_ai',
    label: 'Manage AI features',
    description: 'Trigger AI processing on materials and monitor indexing jobs.'
  },
  {
    key: 'manage_events',
    label: 'Manage events',
    description: 'Create, publish, update, and moderate campus events.'
  },
  {
    key: 'manage_organizations',
    label: 'Manage organizations',
    description: 'Approve and manage campus organizations and memberships.'
  },
  {
    key: 'moderate_jobs',
    label: 'Moderate jobs',
    description: 'Review job listings and skill profiles for policy compliance.'
  },
  {
    key: 'moderate_services',
    label: 'Moderate services',
    description: 'Review student service listings for policy compliance.'
  },
  {
    key: 'moderate_lost_found',
    label: 'Moderate lost & found',
    description: 'Resolve item claims and moderate lost-and-found reports.'
  },
  {
    key: 'manage_study_groups',
    label: 'Manage study groups',
    description: 'Review and moderate campus study groups.'
  },
  {
    key: 'moderate_reports',
    label: 'Moderate platform reports',
    description: 'Review user reports and record moderation outcomes.'
  },
  {
    key: 'manage_academics',
    label: 'Manage academics',
    description: 'Manage the academic calendar, courses and student records.'
  },
  {
    key: 'manage_lecturers',
    label: 'Manage lecturers',
    description: 'Create and edit lecturer records and course allocations.'
  },
  {
    key: 'manage_calendar',
    label: 'Manage academic calendar',
    description: 'Publish and edit the institution-wide academic calendar.'
  },
  {
    key: 'manage_grading',
    label: 'Manage grading',
    description: 'Define grading scales and record or publish student grades.'
  },
  {
    key: 'manage_learning',
    label: 'Manage learning content',
    description: 'Create, publish and moderate Skills & Learning content.'
  }
];

export const SUPER_ADMIN_PERMISSIONS = [
  'manage_admins',
  ...ALL_PERMISSIONS.map((p) => p.key)
] as string[];

export const DEFAULT_ADMIN_PERMISSIONS = [
  'approve_materials',
  'reject_materials',
  'delete_any_material',
  'upload_as_approved',
  'manage_students',
  'view_analytics',
  'manage_ai'
] as string[];

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export function isSuperAdminRole(role: string | null | undefined): boolean {
  return role === 'super_admin';
}

export function isLecturerRole(role: string | null | undefined): boolean {
  return role === 'lecturer';
}

export function can(
  profile: { role?: AppRole | string | null; permissions?: string[] | null; isActive?: boolean } | null,
  permission: string
): boolean {
  if (!profile || profile.isActive === false) return false;
  if (profile.role === 'super_admin') return true;
  if (profile.role !== 'admin') return false;
  return (profile.permissions ?? []).includes(permission);
}

export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'super_admin':
      return 'Super Admin';
    case 'admin':
      return 'Administrator';
    case 'lecturer':
      return 'Lecturer';
    case 'student':
      return 'Student';
    default:
      return 'Member';
  }
}

/** Human-readable labels for permission keys (falls back to the key itself). */
export function permissionLabel(key: string): string {
  if (key === 'manage_admins') return 'Manage administrators';
  return ALL_PERMISSIONS.find((p) => p.key === key)?.label ?? key;
}
