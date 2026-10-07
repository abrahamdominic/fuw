import { removeCampusMedia } from './campusMedia';
import { requireSupabase } from './supabase';

export type CampusListingModule =
  | 'events'
  | 'organizations'
  | 'jobs'
  | 'lost-found'
  | 'study-groups'
  | 'services';

export interface CampusCourse {
  id: string;
  code: string;
  title: string;
  units: number | null;
  semester: string;
  level: string;
}

export interface TrackedCourse extends CampusCourse {
  trackerId: string;
  status: 'registered' | 'in_progress' | 'completed' | 'withdrawn';
  sessionName: string | null;
}

export interface CampusRow {
  id: string;
  [key: string]: unknown;
}

const TABLES: Record<CampusListingModule, string> = {
  events: 'events',
  organizations: 'organizations',
  jobs: 'job_listings',
  'lost-found': 'lost_found_items',
  'study-groups': 'study_groups',
  services: 'service_listings'
};

function readRelation(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? {};
  return (value as Record<string, unknown>) ?? {};
}

export async function fetchCourseCatalogue(department: string): Promise<CampusCourse[]> {
  const { data, error } = await requireSupabase()
    .from('courses')
    .select('id,course_code,course_title,credit_units,semester,levels(name),departments!inner(name)')
    .eq('departments.name', department)
    .order('course_code');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const level = readRelation(row.levels);
    return {
      id: row.id,
      code: row.course_code,
      title: row.course_title,
      units: row.credit_units,
      semester: row.semester ?? 'Semester not set',
      level: String(level.name ?? 'Level not set')
    };
  });
}

export async function fetchTrackedCourses(): Promise<TrackedCourse[]> {
  const { data, error } = await requireSupabase()
    .from('student_course_tracker')
    .select('id,status,academic_sessions(name),course:courses(id,course_code,course_title,credit_units,semester,levels(name))')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const course = readRelation(row.course);
    const level = readRelation(course.levels);
    const session = readRelation(row.academic_sessions);
    return {
      trackerId: row.id,
      id: String(course.id ?? ''),
      code: String(course.course_code ?? ''),
      title: String(course.course_title ?? ''),
      units: typeof course.credit_units === 'number' ? course.credit_units : null,
      semester: String(course.semester ?? 'Semester not set'),
      level: String(level.name ?? 'Level not set'),
      status: row.status,
      sessionName: typeof session.name === 'string' ? session.name : null
    };
  });
}

export async function addTrackedCourse(courseId: string): Promise<void> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to track courses.');

  const { data: session, error: sessionError } = await client
    .from('academic_sessions')
    .select('id')
    .eq('is_active', true)
    .maybeSingle();
  if (sessionError) throw new Error(sessionError.message);

  const { error } = await client.from('student_course_tracker').insert({
    student_id: user.id,
    course_id: courseId,
    academic_session_id: session?.id ?? null
  });
  if (error) throw new Error(error.code === '23505' ? 'This course is already in your tracker.' : error.message);
}

export async function updateTrackedCourse(
  trackerId: string,
  status: TrackedCourse['status']
): Promise<void> {
  const { error } = await requireSupabase()
    .from('student_course_tracker')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', trackerId);
  if (error) throw new Error(error.message);
}

export async function removeTrackedCourse(trackerId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('student_course_tracker')
    .delete()
    .eq('id', trackerId);
  if (error) throw new Error(error.message);
}

export async function fetchCampusListings(
  module: CampusListingModule
): Promise<CampusRow[]> {
  const client = requireSupabase();
  const table = TABLES[module];
  const orderColumn = module === 'events' ? 'starts_at' : 'created_at';
  const { data, error } = await client
    .from(table)
    .select('*')
    .order(orderColumn, { ascending: module === 'events' });
  if (error) throw new Error(error.message);
  return (data ?? []) as CampusRow[];
}

export async function createCampusListing(
  module: CampusListingModule,
  input: Record<string, unknown>
): Promise<void> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to create a listing.');

  const ownershipColumn =
    module === 'events' ? 'organizer_id' :
    module === 'organizations' ? 'owner_id' :
    module === 'study-groups' ? 'owner_id' :
    module === 'lost-found' ? 'owner_id' :
    module === 'services' ? 'owner_id' : 'owner_id';
  const table = TABLES[module];
  const payload = { ...input, [ownershipColumn]: user.id };

  if (module === 'organizations') {
    const base = String(input.name ?? '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
    payload.slug = `${base || 'organization'}-${user.id.slice(0, 8)}`;
    payload.status = 'pending';
  } else if (module === 'events') {
    payload.status = 'draft';
  } else if (module === 'jobs' || module === 'services' || module === 'study-groups') {
    payload.status = 'pending';
  } else if (module === 'lost-found') {
    payload.status = 'open';
  }

  const { error } = await client.from(table).insert(payload);
  if (error) throw new Error(error.message);
}

/** Media column per listing module, so deletes can clean up the stored object. */
const MEDIA_COLUMN: Partial<Record<CampusListingModule, string>> = {
  events: 'cover_image_path',
  'lost-found': 'photo_path'
};

export async function deleteCampusListing(module: CampusListingModule, id: string): Promise<void> {
  const client = requireSupabase();
  const mediaColumn = MEDIA_COLUMN[module];
  // Read the path first so the binary is not orphaned once the row is gone.
  let mediaPath: string | null = null;
  if (mediaColumn) {
    const { data } = await client
      .from(TABLES[module])
      .select(mediaColumn)
      .eq('id', id)
      .maybeSingle();
    const row = data as Record<string, unknown> | null;
    mediaPath = row?.[mediaColumn] ? String(row[mediaColumn]) : null;
  }

  const { error } = await client.from(TABLES[module]).delete().eq('id', id);
  if (error) throw new Error(error.message);

  if (mediaPath) await removeCampusMedia(mediaPath);
}

export async function fetchMyRsvps(): Promise<string[]> {
  const { data, error } = await requireSupabase()
    .from('event_rsvps')
    .select('event_id')
    .eq('status', 'registered');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => String(row.event_id));
}

export async function rsvpToEvent(eventId: string): Promise<void> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to RSVP.');
  const { error } = await client.from('event_rsvps').upsert({
    event_id: eventId,
    student_id: user.id,
    status: 'registered'
  }, { onConflict: 'event_id,student_id' });
  if (error) throw new Error(error.message);
}

export async function cancelEventRsvp(eventId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('event_rsvps')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('event_id', eventId);
  if (error) throw new Error(error.message);
}

export async function requestOrganizationMembership(organizationId: string): Promise<void> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to request membership.');
  const { error } = await client.from('organization_members').insert({
    organization_id: organizationId,
    student_id: user.id
  });
  if (error) throw new Error(error.code === '23505' ? 'You already have a membership request.' : error.message);
}

export async function joinStudyGroup(groupId: string): Promise<void> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to request to join this group.');
  const { error } = await client.from('study_group_members').insert({
    group_id: groupId,
    user_id: user.id
  });
  if (error) throw new Error(error.code === '23505' ? 'You already requested to join this group.' : error.message);
}

export async function createLostFoundClaim(itemId: string, details: string): Promise<void> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to submit an ownership claim.');
  const { error } = await client.from('lost_found_claims').insert({
    item_id: itemId,
    claimant_id: user.id,
    verification_details: details.trim()
  });
  if (error) throw new Error(error.message);
}

export async function reportCampusListing(
  targetType: CampusListingModule,
  targetId: string,
  description: string
): Promise<void> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to report content.');
  const targetTypes: Record<CampusListingModule, string> = {
    events: 'event',
    organizations: 'organization',
    jobs: 'job',
    'lost-found': 'lost_found',
    'study-groups': 'study_group',
    services: 'service'
  };
  const { error } = await client.from('platform_reports').insert({
    reporter_id: user.id,
    target_type: targetTypes[targetType],
    target_id: targetId,
    category: 'other',
    description: description.trim()
  });
  if (error) throw new Error(error.message);
}

// ── Notification Preferences ──────────────────────────────────────────────────

export interface NotificationPreference {
  category: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  push_enabled: boolean;
}

export const NOTIFICATION_CATEGORIES = [
  { key: 'academic', label: 'Academic', description: 'Assignment reminders, course updates, academic calendar.' },
  { key: 'events', label: 'Events', description: 'Campus event confirmations and reminders.' },
  { key: 'organizations', label: 'Organizations', description: 'Membership approvals and organization announcements.' },
  { key: 'marketplace', label: 'Marketplace', description: 'Service and order updates.' },
  { key: 'messages', label: 'Messages', description: 'Direct message notifications.' },
  { key: 'jobs', label: 'Jobs & Gigs', description: 'Job listing updates and application activity.' },
  { key: 'study_groups', label: 'Study Groups', description: 'Group invitations and activity.' },
  { key: 'payments', label: 'Payments', description: 'Payment and subscription updates.' },
  { key: 'platform', label: 'Platform', description: 'Lost & found claims, moderation updates, and platform notices.' },
] as const;

export async function fetchNotificationPreferences(): Promise<NotificationPreference[]> {
  const { data, error } = await requireSupabase()
    .from('notification_preferences')
    .select('category,in_app_enabled,email_enabled,push_enabled');
  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationPreference[];
}

export async function upsertNotificationPreference(
  category: string,
  field: 'in_app_enabled' | 'email_enabled' | 'push_enabled',
  value: boolean
): Promise<void> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to update notification preferences.');
  const { error } = await client.from('notification_preferences').upsert({
    user_id: user.id,
    category,
    [field]: value,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,category' });
  if (error) throw new Error(error.message);
}
