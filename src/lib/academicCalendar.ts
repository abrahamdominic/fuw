import { requireSupabase } from './supabase';

export interface SemesterCalendarEntry {
  label: string;
  starts_on: string;
  ends_on: string;
}

export interface SemesterCalendar {
  first: SemesterCalendarEntry;
  second: SemesterCalendarEntry;
}

export const DEFAULT_SEMESTER_CALENDAR: SemesterCalendar = {
  first: { label: 'First Semester', starts_on: '2025-09-15', ends_on: '2026-01-31' },
  second: { label: 'Second Semester', starts_on: '2026-02-01', ends_on: '2026-06-30' }
};

export async function fetchSemesterCalendar(): Promise<SemesterCalendar> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_semester_calendar');
  if (error || !data) return DEFAULT_SEMESTER_CALENDAR;
  return {
    first: { ...DEFAULT_SEMESTER_CALENDAR.first, ...(data.first || {}) },
    second: { ...DEFAULT_SEMESTER_CALENDAR.second, ...(data.second || {}) }
  };
}

export async function saveSemesterCalendar(calendar: SemesterCalendar): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('set_semester_calendar', { p_value: calendar });
  if (error) throw new Error(error.message);
}
