import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const dir = '/home/abraham/fuw/100 2nd Semester';
const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf')).sort();

async function main() {
  let found = files.length;
  let imported = 0;
  let failed = 0;
  let existed = 0;
  
  // Get an admin user to assign as uploader
  const { data: adminUser } = await admin
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'super_admin'])
    .limit(1)
    .single();
  
  const uploaderId = adminUser?.id || null;
  
  for (const fname of files) {
    try {
      const { data: existing } = await admin
        .from('materials')
        .select('id')
        .eq('file_name', fname)
        .limit(1);
      if (existing && existing.length > 0) {
        existed++;
        continue;
      }
      const fullPath = path.join(dir, fname);
      const buffer = fs.readFileSync(fullPath);
      const safeName = fname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `admin/${Date.now()}-${safeName}`;
      const { error: upErr } = await admin.storage
        .from('library-materials')
        .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });
      if (upErr) throw upErr;
      const { data: dept } = await admin
        .from('departments')
        .select('id, faculty_id, name')
        .ilike('name', '%microbiology%')
        .limit(1);
      const deptId = dept?.[0]?.id || null;
      const facId = dept?.[0]?.faculty_id || null;
      const { data: inserted, error: insErr } = await admin
        .from('materials')
        .insert({
          title: fname.replace(/\.pdf$/i, ''),
          description: 'Microbiology 100 Level, Second Semester material',
          faculty: 'Faculty of Bio-Sciences',
          department: dept?.[0]?.name || 'Microbiology',
          faculty_id: facId,
          department_id: deptId,
          course_code: 'BIO102C',
          course_title: 'General Biology II',
          level: '100 Level',
          semester: 'Second Semester',
          material_type: 'Lecture Note',
          academic_session: '',
          status: 'approved',
          uploaded_by: uploaderId,
          file_path: storagePath,
          file_name: fname,
          file_size: buffer.length,
          file_url: ''
        })
        .select('id')
        .single();
      if (insErr) throw insErr;
      if (inserted && deptId) {
        await admin
          .from('material_departments')
          .upsert([{ material_id: inserted.id, department_id: deptId }], {
            onConflict: 'material_id, department_id'
          });
      }
      imported++;
    } catch (e: any) {
      console.error('FAIL', fname, e?.message || e);
      failed++;
    }
  }
  console.log({ found, imported, existed, failed });
}

main();
