import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, ShieldCheck, Library, CircleCheck, CircleX } from 'lucide-react';
import { requireSupabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { allCoursesFlat } from '../data/catalogue';
import {
  flagNearDuplicates,
  type LibraryMaterialRecord,
} from '../lib/libraryDedup';

interface CbtBankRow {
  course_code: string;
  course_title: string;
  total_questions: number;
  material_derived: number;
  curated_added: number;
  active_questions: number;
  meets_120: boolean;
}

interface LibraryHealthRow {
  course_code: string;
  course_title: string;
  approved_materials: number;
  total_materials: number;
  file_objects: number;
  broken_refs: number;
  duplicate_files: number;
}

interface StorageAudit {
  total_objects: number;
  matched_objects: number;
  orphan_objects: number;
  total_size_bytes: number;
}

interface MaterialRow {
  id: string;
  title: string;
  course_code: string | null;
  course_title: string | null;
  file_path: string | null;
  file_size: number | null;
  downloads: number;
  views: number;
  status: string;
}

export function AdminCbtLibraryTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [bank, setBank] = useState<CbtBankRow[]>([]);
  const [health, setHealth] = useState<LibraryHealthRow[]>([]);
  const [audit, setAudit] = useState<StorageAudit | null>(null);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bankRes, healthRes, auditRes, materialsRes] = await Promise.all([
        requireSupabase().rpc('cbt_bank_report'),
        requireSupabase().rpc('library_health_report'),
        requireSupabase().rpc('library_storage_audit'),
        requireSupabase()
          .from('materials')
          .select('id,title,course_code,course_title,file_path,file_size,downloads,views,status')
          .limit(5000),
      ]);
      if (bankRes.error) throw new Error(bankRes.error.message);
      if (healthRes.error) throw new Error(healthRes.error.message);
      if (auditRes.error) throw new Error(auditRes.error.message);
      if (materialsRes.error) throw new Error(materialsRes.error.message);
      setBank((bankRes.data as CbtBankRow[]) || []);
      setHealth((healthRes.data as LibraryHealthRow[]) || []);
      setAudit((auditRes.data as StorageAudit) || null);
      setMaterials((materialsRes.data as MaterialRow[]) || []);
    } catch (error) {
      toast(`Could not load CBT & library report: ${(error as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const totalQuestions = bank.reduce((sum, row) => sum + row.active_questions, 0);

  const allKnownCodes = allCoursesFlat().map((course) => course.code.toUpperCase());
  const bankedCodes = new Set(bank.map((row) => row.course_code));
  const coursesWithoutBank = allKnownCodes
    .filter((code) => !bankedCodes.has(code))
    .sort((a, b) => a.localeCompare(b));

  const nearClusters = useMemo(() => {
    const records: LibraryMaterialRecord[] = materials.map((m) => ({
      id: m.id,
      title: m.title,
      courseCode: m.course_code,
      courseTitle: m.course_title,
      filePath: m.file_path,
      fileSize: m.file_size,
      etag: null,
      downloads: m.downloads,
      views: m.views,
      isApproved: m.status === 'approved',
    }));
    return flagNearDuplicates(records, 0.9);
  }, [materials]);

  if (loading) {
    return (
      <div className="admin-empty-state" style={{ textAlign: 'center', padding: '60px 0' }}>
        <Loader2 className="spin" size={32} />
        <p>Loading CBT &amp; library health report…</p>
      </div>
    );
  }

  return (
    <div className="admin-tab">
      <div className="tab-header">
        <div className="tab-title-block">
          <div className="tab-title">CBT bank &amp; E-Library health</div>
          <div className="tab-subtitle">Live figures only — computed from the database and library storage.</div>
        </div>
      </div>

      <div className="stat-cards">
        <div className="stat-card">
          <span className="stat-value">{bank.length}</span>
          <span className="stat-label">Courses with a CBT bank</span>
        </div>
        <div className="stat-card approved">
          <span className="stat-value">{totalQuestions}</span>
          <span className="stat-label">Active questions</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{audit?.total_objects ?? 0}</span>
          <span className="stat-label">Library files</span>
        </div>
        <div className="stat-card pending">
          <span className="stat-value">{audit?.orphan_objects ?? 0}</span>
          <span className="stat-label">Orphaned files</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">
            {audit ? (audit.total_size_bytes / 1024 / 1024).toFixed(1) : '0'}
            <small> MB</small>
          </span>
          <span className="stat-label">Library size</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <Library size={18} />
          <span>CBT bank coverage</span>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Active</th>
              <th>Material-derived</th>
              <th>Curated</th>
              <th>Meets 120</th>
            </tr>
          </thead>
          <tbody>
            {bank.map((row) => (
              <tr key={row.course_code}>
                <td>
                  <strong>{row.course_code}</strong>
                  <span className="muted"> — {row.course_title}</span>
                </td>
                <td>{row.active_questions}</td>
                <td>{row.material_derived}</td>
                <td>{row.curated_added}</td>
                <td>
                  {row.meets_120 ? (
                    <span className="verified-badge">
                      <CircleCheck size={14} /> Yes
                    </span>
                  ) : (
                    <span className="pending-badge">
                      <CircleX size={14} /> No
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {bank.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">No CBT questions yet.</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="muted" style={{ padding: '12px 16px', margin: 0 }}>
          <ShieldCheck size={14} /> {coursesWithoutBank.length.toLocaleString()} of{' '}
          {allKnownCodes.length.toLocaleString()} catalogue courses have no approved source
          material yet, so no material-derived questions and no fulfilled bank. Adding source
          materials or curated banks for those courses is required before they can reach 120
          questions.
        </p>
      </div>

      <div className="panel">
        <div className="panel-header">
          <Library size={18} />
          <span>E-Library health</span>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Approved files</th>
              <th>Storage objects</th>
              <th>Broken refs</th>
              <th>Duplicate files</th>
            </tr>
          </thead>
          <tbody>
            {health.map((row) => (
              <tr key={row.course_code}>
                <td>
                  <strong>{row.course_code}</strong>
                  <span className="muted"> — {row.course_title}</span>
                </td>
                <td>{row.approved_materials}</td>
                <td>{row.file_objects}</td>
                <td>{row.broken_refs > 0 ? <span className="danger-text">{row.broken_refs}</span> : row.broken_refs}</td>
                <td>{row.duplicate_files > 0 ? <span className="danger-text">{row.duplicate_files}</span> : row.duplicate_files}</td>
              </tr>
            ))}
            {health.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">No uploaded materials.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {nearClusters.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <CircleX size={18} />
            <span>Near-duplicate titles — manual review only</span>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Similarity</th>
                <th>Titles</th>
              </tr>
            </thead>
            <tbody>
              {nearClusters.map((cluster, index) => (
                <tr key={index}>
                  <td>{cluster.courseCode}</td>
                  <td>{Math.round(cluster.maxSimilarity * 100)}%</td>
                  <td>{cluster.records.map((r) => `“${r.title}”`).join('  ·  ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}