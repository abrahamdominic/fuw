import React from 'react';
import { X, Building2, Layers, Hash } from 'lucide-react';
import { MaterialItem } from '../lib/store';
import { AnimatedModal } from './animations/AnimatedModal';

interface AssignedDepartmentsModalProps {
  material: MaterialItem | null;
  isOpen: boolean;
  onClose: () => void;
}

const shortFaculty = (name: string) =>
  name.replace(/^Faculty\s+(of\s+)?/i, '').replace(/\s+College\s*$/i, '').trim();

export function AssignedDepartmentsModal({
  material,
  isOpen,
  onClose
}: AssignedDepartmentsModalProps) {
  if (!material) return null;

  const depts =
    material.assignedDepartments && material.assignedDepartments.length > 0
      ? material.assignedDepartments
      : [
          {
            id: '',
            name: material.department,
            facultyName: material.faculty
          }
        ];

  // Group departments by faculty for a cleaner visual layout
  const grouped = depts.reduce<Record<string, typeof depts>>((acc, d) => {
    const key = d.facultyName || 'Other';
    (acc[key] ??= []).push(d);
    return acc;
  }, {});

  return (
    <AnimatedModal
      open={isOpen && material != null}
      onClose={onClose}
      overlayStyle={{ zIndex: 1100 }}
      dialogClassName="adm-modal"
    >
      {/*
       * Header
       */}
        <div className="adm-header">
          <div className="adm-header-left">
            <div className="adm-header-icon">
              <Building2 size={18} />
            </div>
            <div>
              <h3 className="adm-title">Assigned Departments</h3>
              <p className="adm-subtitle">
                {material.course ? `${material.course}: ` : ''}{material.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="adm-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Stats bar */}
        <div className="adm-stats">
          <div className="adm-stat">
            <Layers size={14} />
            <span><b>{depts.length}</b> department{depts.length !== 1 ? 's' : ''}</span>
          </div>
          {Object.keys(grouped).length > 1 && (
            <div className="adm-stat">
              <Hash size={14} />
              <span><b>{Object.keys(grouped).length}</b> faculties</span>
            </div>
          )}
        </div>

        {/* Department list */}
        <div className="adm-body">
          {Object.entries(grouped).map(([faculty, facultyDepts]) => (
            <div key={faculty} className="adm-group">
              {Object.keys(grouped).length > 1 && (
                <div className="adm-group-header">
                  <span className="adm-group-faculty">{shortFaculty(faculty)}</span>
                  <span className="adm-group-count">{facultyDepts.length}</span>
                </div>
              )}
              {facultyDepts.map((d, index) => (
                <div
                  key={d.id || `${d.name}-${index}`}
                  className="adm-dept-row"
                >
                  <div className="adm-dept-info">
                    <div className="adm-dept-dot" />
                    <div className="adm-dept-text">
                      <span className="adm-dept-name">{d.name}</span>
                      {Object.keys(grouped).length <= 1 && d.facultyName && (
                        <span className="adm-dept-fac">{shortFaculty(d.facultyName)}</span>
                      )}
                    </div>
                  </div>
                  <span className="adm-badge">
                    Assigned
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="adm-footer">
          <button
            type="button"
            className="adm-done-btn"
            onClick={onClose}
          >
            Done
          </button>
        </div>
    </AnimatedModal>
  );
}
