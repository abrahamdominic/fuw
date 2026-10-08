import React, { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  GraduationCap,
  Building2,
  Mail,
  Phone,
  Briefcase,
  MapPin,
  FileText,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { useToast } from './Toast';
import { AnimatedModal } from './animations/AnimatedModal';
import { DepartmentAssigner } from './DepartmentAssigner';
import {
  adminOnboardLecturer,
  adminConvertUserToLecturer
} from '../lib/academics';
import { fetchDepartmentCatalogue, type DepartmentOption } from '../lib/materials';
import { catalogue } from '../data/catalogue';

export interface LecturerOnboardTarget {
  id: string;
  fullName?: string | null;
  email: string;
  faculty?: string | null;
  department?: string | null;
}

interface LecturerOnboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  targetUser?: LecturerOnboardTarget | null;
}

const ACADEMIC_RANKS = [
  'Professor',
  'Associate Professor',
  'Senior Lecturer',
  'Lecturer I',
  'Lecturer II',
  'Assistant Lecturer',
  'Graduate Assistant',
  'Visiting Lecturer',
  'Adjunct Lecturer'
];

export function LecturerOnboardModal({
  isOpen,
  onClose,
  onSuccess,
  targetUser
}: LecturerOnboardModalProps) {
  const { toast } = useToast();

  const isConverting = !!targetUser;

  const [fullName, setFullName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [staffId, setStaffId] = useState('');
  const [academicRank, setAcademicRank] = useState('Lecturer II');
  const [officeLocation, setOfficeLocation] = useState('');
  const [bio, setBio] = useState('');

  const [facultyName, setFacultyName] = useState(catalogue[0]?.name || '');
  const [departmentName, setDepartmentName] = useState(catalogue[0]?.departments[0]?.name || '');

  const [assignedDepartments, setAssignedDepartments] = useState<DepartmentOption[]>([]);
  const [catalogueOptions, setCatalogueOptions] = useState<DepartmentOption[]>([]);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load department options from database
  useEffect(() => {
    fetchDepartmentCatalogue()
      .then((opts) => setCatalogueOptions(opts))
      .catch(() => {});
  }, []);

  // Sync state when opening or targetUser changes
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      if (targetUser) {
        setFullName(targetUser.fullName || '');
        setStaffEmail(targetUser.email || '');
        if (targetUser.faculty) setFacultyName(targetUser.faculty);
        if (targetUser.department) setDepartmentName(targetUser.department);
      } else {
        setFullName('');
        setStaffEmail('');
        setPhone('');
        setStaffId('');
        setAcademicRank('Lecturer II');
        setOfficeLocation('');
        setBio('');
        setFacultyName(catalogue[0]?.name || '');
        setDepartmentName(catalogue[0]?.departments[0]?.name || '');
        setAssignedDepartments([]);
      }
    }
  }, [isOpen, targetUser]);

  // Available faculties from catalogue
  const faculties = catalogue.map((f) => f.name);

  // Available primary departments based on selected faculty
  const currentFacultyDepartments =
    catalogue.find((f) => f.name === facultyName)?.departments.map((d) => d.name) || [];

  const handleFacultyChange = (newFac: string) => {
    setFacultyName(newFac);
    const depts = catalogue.find((f) => f.name === newFac)?.departments || [];
    if (depts.length > 0) {
      setDepartmentName(depts[0].name);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!fullName.trim()) {
      setErrorMsg('Lecturer full name is required.');
      return;
    }
    if (!staffEmail.trim() || !staffEmail.includes('@')) {
      setErrorMsg('A valid email address is required.');
      return;
    }

    setBusy(true);
    try {
      // Find UUIDs for faculty and primary department if in database options
      const primaryDeptOption = catalogueOptions.find(
        (o) => o.name.toLowerCase() === departmentName.toLowerCase()
      );
      const facultyId = primaryDeptOption?.facultyId || undefined;
      const departmentId = primaryDeptOption?.id && primaryDeptOption.id !== departmentName
        ? primaryDeptOption.id
        : undefined;

      const secondaryDeptIds = assignedDepartments
        .map((d) => d.id)
        .filter((id) => id && id.length > 10 && id.includes('-'));

      if (isConverting && targetUser) {
        await adminConvertUserToLecturer({
          userId: targetUser.id,
          staffId: staffId.trim() || null,
          academicRank: academicRank.trim() || null,
          officeLocation: officeLocation.trim() || null,
          facultyId: facultyId || null,
          departmentId: departmentId || null,
          departmentIds: secondaryDeptIds.length > 0 ? secondaryDeptIds : null,
          fullName: fullName.trim() || undefined
        });
        toast(
          `Converted ${fullName || targetUser.email} to Lecturer successfully.`,
          'success'
        );
      } else {
        await adminOnboardLecturer({
          fullName: fullName.trim(),
          staffEmail: staffEmail.trim(),
          phone: phone.trim() || null,
          staffId: staffId.trim() || null,
          academicRank: academicRank.trim() || null,
          officeLocation: officeLocation.trim() || null,
          bio: bio.trim() || null,
          facultyId: facultyId || null,
          departmentId: departmentId || null,
          departmentIds: secondaryDeptIds.length > 0 ? secondaryDeptIds : null
        });
        toast(`Lecturer "${fullName.trim()}" onboarded successfully.`, 'success');
      }

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to complete lecturer onboarding.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatedModal open={isOpen} onClose={onClose} dialogStyle={{ maxWidth: '680px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
      <div style={{ padding: '24px 28px' }}>
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '18px',
            borderBottom: '1px solid #e1ece3',
            paddingBottom: '14px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                backgroundColor: '#e7f5eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#1e6f43'
              }}
            >
              {isConverting ? <GraduationCap size={20} /> : <UserPlus size={20} />}
            </div>
            <div>
              <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700, color: '#133e26' }}>
                {isConverting ? 'Convert Account to Lecturer' : 'Onboard New Academic Lecturer'}
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#577565' }}>
                {isConverting
                  ? 'Assign lecturer credentials and institutional scope to this university account.'
                  : 'Register lecturer credentials, faculty affiliation, and teaching departments.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close modal"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#668070',
              padding: '6px'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {errorMsg && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 14px',
              backgroundColor: '#fde8e8',
              color: '#9b1c1c',
              borderRadius: '8px',
              fontSize: '13px',
              marginBottom: '16px'
            }}
          >
            <AlertCircle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Identity Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#1f3d2b' }}>
              Full Name *
              <input
                required
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Dr. Musa Aliyu Ibrahim"
                disabled={busy}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cddcd2',
                  fontSize: '13px'
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#1f3d2b' }}>
              Staff Email *
              <input
                required
                type="email"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value.toLowerCase())}
                placeholder="e.g. m.aliyu@fuwukari.edu.ng"
                disabled={busy || isConverting}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cddcd2',
                  fontSize: '13px',
                  backgroundColor: isConverting ? '#f5f7f5' : '#fff'
                }}
              />
            </label>
          </div>

          {/* Academic Scope Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#1f3d2b' }}>
              Academic Rank / Title
              <select
                value={academicRank}
                onChange={(e) => setAcademicRank(e.target.value)}
                disabled={busy}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cddcd2',
                  fontSize: '13px',
                  backgroundColor: '#fff'
                }}
              >
                {ACADEMIC_RANKS.map((rank) => (
                  <option key={rank} value={rank}>
                    {rank}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#1f3d2b' }}>
              Staff ID / File Number
              <input
                type="text"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                placeholder="e.g. FUW/ACAD/2024/098"
                disabled={busy}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cddcd2',
                  fontSize: '13px'
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#1f3d2b' }}>
              Office Location
              <input
                type="text"
                value={officeLocation}
                onChange={(e) => setOfficeLocation(e.target.value)}
                placeholder="e.g. Block B, Room 204"
                disabled={busy}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cddcd2',
                  fontSize: '13px'
                }}
              />
            </label>
          </div>

          {/* Phone & Bio */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#1f3d2b' }}>
              Phone Number
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 08012345678"
                disabled={busy}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cddcd2',
                  fontSize: '13px'
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#1f3d2b' }}>
              Brief Bio / Specialization
              <input
                type="text"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="e.g. Specializing in Distributed Systems & AI"
                disabled={busy}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cddcd2',
                  fontSize: '13px'
                }}
              />
            </label>
          </div>

          {/* Primary Faculty & Department */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#1f3d2b' }}>
              Primary Faculty *
              <select
                value={facultyName}
                onChange={(e) => handleFacultyChange(e.target.value)}
                disabled={busy}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cddcd2',
                  fontSize: '13px',
                  backgroundColor: '#fff'
                }}
              >
                {faculties.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#1f3d2b' }}>
              Primary Department *
              <select
                value={departmentName}
                onChange={(e) => setDepartmentName(e.target.value)}
                disabled={busy}
                style={{
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid #cddcd2',
                  fontSize: '13px',
                  backgroundColor: '#fff'
                }}
              >
                {currentFacultyDepartments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Multi-department assignment section */}
          <div style={{ marginTop: '4px', borderTop: '1px solid #e1ece3', paddingTop: '12px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 600, color: '#1f3d2b' }}>
              Secondary Teaching Departments (Optional)
            </p>
            <DepartmentAssigner
              selectedDepartments={assignedDepartments}
              onChange={setAssignedDepartments}
              required={false}
            />
          </div>

          {/* Footer Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '10px',
              marginTop: '12px',
              borderTop: '1px solid #e1ece3',
              paddingTop: '14px'
            }}
          >
            <button
              type="button"
              className="outline-btn"
              onClick={onClose}
              disabled={busy}
              style={{ padding: '8px 18px', fontSize: '13px' }}
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
                padding: '8px 22px',
                fontSize: '13px',
                fontWeight: 600
              }}
            >
              {busy ? (
                <>
                  <Loader2 size={15} className="spin-icon" /> Saving…
                </>
              ) : isConverting ? (
                <>
                  <GraduationCap size={15} /> Confirm Lecturer Role
                </>
              ) : (
                <>
                  <UserPlus size={15} /> Complete Onboarding
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </AnimatedModal>
  );
}
