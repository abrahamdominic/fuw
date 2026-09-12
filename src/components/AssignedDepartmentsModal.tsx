import React from 'react';
import { X, Building2, Layers } from 'lucide-react';
import { MaterialItem } from '../lib/store';

interface AssignedDepartmentsModalProps {
  material: MaterialItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export function AssignedDepartmentsModal({
  material,
  isOpen,
  onClose
}: AssignedDepartmentsModalProps) {
  if (!isOpen || !material) return null;

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

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '520px' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Building2 size={20} color="#0B6B3A" />
            <div>
              <h3 style={{ margin: 0, fontSize: '15px' }}>Assigned Departments</h3>
              <p style={{ margin: 0, fontSize: '12px', color: '#666' }}>
                {material.course ? `${material.course} — ` : ''}{material.title}
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

        <div className="modal-body" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#555' }}>
              Total Assigned: <b>{depts.length} department{depts.length !== 1 ? 's' : ''}</b>
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
            {depts.map((d, index) => (
              <div
                key={d.id || `${d.name}-${index}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 12px',
                  backgroundColor: '#f8faf9',
                  border: '1px solid #e1ece3',
                  borderRadius: '6px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building2 size={16} color="#0B6B3A" />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#1b382b' }}>
                      {d.name}
                    </div>
                    {d.facultyName && (
                      <div style={{ fontSize: '11px', color: '#55675b' }}>
                        {d.facultyName}
                      </div>
                    )}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: '#eaf3ec',
                    color: '#0B6B3A'
                  }}
                >
                  Assigned
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', borderTop: '1px solid #e1ece3', paddingTop: '12px' }}>
            <button
              type="button"
              className="primary"
              onClick={onClose}
              style={{
                padding: '6px 18px',
                borderRadius: '6px',
                backgroundColor: '#0B6B3A',
                color: '#fff',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
