import React, { useState, useEffect } from 'react';
import { X, Save, AlertCircle, Loader2, BookOpen, Layers, Calendar, Tag } from 'lucide-react';
import { MaterialItem } from '../lib/store';
import { useStore } from '../lib/useStore';
import { updateMaterial as updateMaterialDb, type DepartmentOption } from '../lib/materials';
import { DepartmentAssigner } from './DepartmentAssigner';
import { materialTypes, levelsFor } from '../data/catalogue';
import { useToast } from './Toast';
import { AnimatedModal } from './animations/AnimatedModal';

interface EditMaterialModalProps {
  material: MaterialItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function EditMaterialModal({
  material,
  isOpen,
  onClose,
  onSaved
}: EditMaterialModalProps) {
  const store = useStore();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [level, setLevel] = useState('100 Level');
  const [semester, setSemester] = useState('First Semester');
  const [materialType, setMaterialType] = useState('Lecture Note');
  const [academicSession, setAcademicSession] = useState('2025/2026');
  const [assignedDepartments, setAssignedDepartments] = useState<DepartmentOption[]>([]);
  const [initialDepartments, setInitialDepartments] = useState<DepartmentOption[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (material) {
      setTitle(material.title || '');
      setDescription(material.description || '');
      setCourseCode(material.course || '');
      setCourseTitle(material.courseTitle || '');
      setLevel(material.level || '100 Level');
      setSemester(material.semester || 'First Semester');
      setMaterialType(material.type || 'Lecture Note');
      setAcademicSession(material.session || '2025/2026');

      if (material.assignedDepartments && material.assignedDepartments.length > 0) {
        const depts = material.assignedDepartments.map((d) => ({
          id: d.id,
          name: d.name,
          facultyId: d.facultyId,
          facultyName: d.facultyName || material.faculty
        }));
        setAssignedDepartments(depts);
        setInitialDepartments(depts);
      } else if (material.department) {
        const single = [
          {
            id: '',
            name: material.department,
            facultyName: material.faculty
          }
        ];
        setAssignedDepartments(single);
        setInitialDepartments(single);
      } else {
        setAssignedDepartments([]);
        setInitialDepartments([]);
      }
      setError(null);
    }
  }, [material]);

  if (!material) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Material title is required.');
      return;
    }
    if (!description.trim()) {
      setError('Academic description is required.');
      return;
    }
    if (assignedDepartments.length === 0) {
      setError('Please assign this material to at least one department.');
      return;
    }

    setBusy(true);
    setError(null);

    const primaryDept = assignedDepartments[0].name;
    const primaryFaculty = assignedDepartments[0].facultyName || material.faculty;
    const departmentIds = assignedDepartments.map((d) => d.id).filter(Boolean);

    try {
      await updateMaterialDb(material.id, {
        title: title.trim(),
        description: description.trim(),
        faculty: primaryFaculty,
        department: primaryDept,
        department_ids: departmentIds,
        course_code: courseCode.trim().toUpperCase(),
        course_title: courseTitle.trim() || undefined,
        level,
        semester,
        material_type: materialType,
        academic_session: academicSession
      });

      // Update in local store
      store.editMaterial(
        material.id,
        {
          title: title.trim(),
          description: description.trim(),
          faculty: primaryFaculty,
          department: primaryDept,
          assignedDepartments: assignedDepartments.map((d) => ({
            id: d.id,
            name: d.name,
            facultyId: d.facultyId,
            facultyName: d.facultyName
          })),
          course: courseCode.trim().toUpperCase(),
          courseTitle: courseTitle.trim() || undefined,
          level,
          semester,
          type: materialType,
          session: academicSession
        },
        'Administrator'
      );

      toast('Material updated successfully! Department assignments have been updated.', 'success');
      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update material.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatedModal
      open={isOpen}
      onClose={onClose}
      overlayStyle={{ zIndex: 1100 }}
      dialogStyle={{ maxWidth: '720px', maxHeight: '90vh', overflowY: 'auto' }}
    >
      <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BookOpen size={20} color="#0B6B3A" />
            <div>
              <h3 style={{ margin: 0, fontSize: '16px' }}>Edit Material & Department Assignments</h3>
              <p style={{ margin: 0, fontSize: '12px', color: '#666' }}>
                Update syllabus details and assign to one or multiple departments
              </p>
            </div>
          </div>
          <button
            type="button"
            className="action-icon-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {error && (
            <div className="form-feedback-box error" style={{ padding: '10px 14px', borderRadius: '6px' }}>
              <AlertCircle size={18} />
              <p style={{ margin: 0 }}>{error}</p>
            </div>
          )}

          {/* Title & Description */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', fontWeight: 600 }}>
              Material Title *
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. CSC 201 — Data Structures and Algorithms"
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px' }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', fontWeight: 600 }}>
              Academic Description *
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={3}
                placeholder="Brief summary of modules, topics, or units covered in this material..."
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', resize: 'vertical' }}
              />
            </label>
          </div>

          {/* Course, Level, Semester Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600 }}>
              Course Code
              <input
                type="text"
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                placeholder="e.g. CSC 201"
                style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px' }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600 }}>
              Course Title
              <input
                type="text"
                value={courseTitle}
                onChange={(e) => setCourseTitle(e.target.value)}
                placeholder="e.g. Data Structures"
                style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px' }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600 }}>
              Level
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', backgroundColor: '#fff' }}
              >
                {['100 Level', '200 Level', '300 Level', '400 Level', '500 Level', '600 Level'].map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600 }}>
              Semester
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', backgroundColor: '#fff' }}
              >
                <option value="First Semester">First Semester</option>
                <option value="Second Semester">Second Semester</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600 }}>
              Material Type
              <select
                value={materialType}
                onChange={(e) => setMaterialType(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', backgroundColor: '#fff' }}
              >
                {materialTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600 }}>
              Academic Session
              <input
                type="text"
                value={academicSession}
                onChange={(e) => setAcademicSession(e.target.value)}
                placeholder="2025/2026"
                style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px' }}
              />
            </label>
          </div>

          {/* Department Assigner Section */}
          <div style={{ marginTop: '8px', borderTop: '1px solid #e1ece3', paddingTop: '16px' }}>
            <DepartmentAssigner
              selectedDepartments={assignedDepartments}
              onChange={setAssignedDepartments}
              error={assignedDepartments.length === 0 ? 'At least one department is required.' : null}
              initialDepartments={initialDepartments}
            />
          </div>

          {/* Modal Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px', borderTop: '1px solid #e1ece3', paddingTop: '14px' }}>
            <button
              type="button"
              className="btn outline"
              onClick={onClose}
              disabled={busy}
              style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cddcd2', background: '#fff', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 20px',
                borderRadius: '6px',
                backgroundColor: '#0B6B3A',
                color: '#fff',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer'
              }}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              <span>{busy ? 'Saving…' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
    </AnimatedModal>
  );
}
