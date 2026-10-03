import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  const { data, error } = await admin
    .from('materials')
    .select('id, title, file_name, material_type, semester, level')
    .eq('level', '100 Level')
    .eq('semester', 'Second Semester')
    .like('file_name', '%BIO%')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  let corrected = 0;
  for (const m of data || []) {
    const name = (m.file_name || m.title || '').toLowerCase();
    let newType = m.material_type;
    if (name.includes('exam') || name.includes('past quest')) newType = 'Exam Past Question';
    else if (name.includes('test') && name.includes('quest')) newType = 'Test Past Questions';
    else if (name.includes('handout')) newType = 'Handouts';
    else if (name.includes('lecture') || name.includes('note')) newType = 'Lecture Note';
    if (newType !== m.material_type) {
      await admin.from('materials').update({ material_type: newType }).eq('id', m.id);
      corrected++;
    }
  }
  console.log({ total: data?.length || 0, corrected });
}

main();
