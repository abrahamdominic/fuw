import { requireSupabase, supabase } from './supabase';
import { store, MaterialItem } from './store';

const allowed = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

export const validateMaterialFile = (file: File) => {
  if (file.size > 25 * 1024 * 1024) throw new Error('File must be 25 MB or smaller.');
  // Check extension or MIME type
  const validExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(file.type) && !validExtensions.includes(ext)) {
    throw new Error('Use a PDF, DOC, DOCX, PPT, PPTX, XLS, or XLSX file.');
  }
};

export async function submitMaterial(input: {
  title: string;
  description: string;
  faculty: string;
  department: string;
  course_code: string;
  course_title?: string;
  level: string;
  semester: string;
  material_type: string;
  file: File;
  admin?: boolean;
}): Promise<MaterialItem> {
  validateMaterialFile(input.file);

  // Update central reactive store immediately
  let createdItem: MaterialItem;
  if (input.admin) {
    createdItem = store.publishMaterialAdmin(input);
  } else {
    createdItem = store.submitMaterialStudent(input);
  }

  // If Supabase is available and authenticated, also sync with remote storage/db
  if (supabase) {
    try {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (user) {
        const safe = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${user.id}/${input.faculty}/${input.department}/${input.level}/${Date.now()}-${safe}`;
        const { error: storageError } = await supabase.storage
          .from('library-materials')
          .upload(path, input.file, { contentType: input.file.type, upsert: false });

        if (!storageError) {
          const { data: url } = supabase.storage.from('library-materials').getPublicUrl(path);
          await supabase.from('materials').insert({
            ...input,
            file_url: url.publicUrl,
            file_name: input.file.name,
            uploaded_by: user.id,
            status: input.admin ? 'approved' : 'pending'
          });
        }
      }
    } catch {
      // Remote sync is optional in offline/local-first mode
    }
  }

  return createdItem;
}
