import { requireSupabase } from './supabase';

export interface GenderCountRow {
  gender: string;
  count: number;
}

export interface NameCountRow {
  name: string;
  count: number;
}

export async function fetchGenderCounts(): Promise<GenderCountRow[]> {
  const { data, error } = await requireSupabase().rpc('count_students_by_gender');
  if (error) throw new Error(error.message);
  return (data || []) as GenderCountRow[];
}

export async function fetchMaterialsByFaculty(): Promise<NameCountRow[]> {
  const { data, error } = await requireSupabase().rpc('count_materials_by_faculty');
  if (error) throw new Error(error.message);
  return (data || []) as NameCountRow[];
}

export async function fetchMaterialsByDepartment(): Promise<NameCountRow[]> {
  const { data, error } = await requireSupabase().rpc('count_materials_by_department');
  if (error) throw new Error(error.message);
  return (data || []) as NameCountRow[];
}