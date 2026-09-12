import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, Check, Building2, Layers, AlertCircle, Plus } from 'lucide-react';
import { fetchDepartmentCatalogue, type DepartmentOption } from '../lib/materials';
import { catalogue } from '../data/catalogue';

export interface DepartmentAssignerProps {
  selectedDepartments: DepartmentOption[];
  onChange: (selected: DepartmentOption[]) => void;
  error?: string | null;
  required?: boolean;
}

export function DepartmentAssigner({
  selectedDepartments,
  onChange,
  error,
  required = true
}: DepartmentAssignerProps) {
  const [allDepartments, setAllDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFaculty, setSelectedFaculty] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    fetchDepartmentCatalogue()
      .then((depts) => {
        if (!cancelled) {
          setAllDepartments(depts);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Static fallback from catalogue
          const fallback = catalogue.flatMap((f) =>
            f.departments.map((d) => ({
              id: d.name,
              name: d.name,
              facultyName: f.name
            }))
          );
          setAllDepartments(fallback);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // List of unique faculties from all available departments
  const availableFaculties = useMemo(() => {
    const set = new Set<string>();
    for (const d of allDepartments) {
      if (d.facultyName) set.add(d.facultyName);
    }
    return Array.from(set).sort();
  }, [allDepartments]);

  // Set of selected department names or IDs for fast lookup
  const selectedKeySet = useMemo(() => {
    const keys = new Set<string>();
    for (const d of selectedDepartments) {
      keys.add(d.name.toLowerCase());
      if (d.id) keys.add(d.id.toLowerCase());
    }
    return keys;
  }, [selectedDepartments]);

  const isSelected = (dept: DepartmentOption) => {
    return (
      selectedKeySet.has(dept.name.toLowerCase()) ||
      (!!dept.id && selectedKeySet.has(dept.id.toLowerCase()))
    );
  };

  const handleToggle = (dept: DepartmentOption) => {
    if (isSelected(dept)) {
      onChange(
        selectedDepartments.filter(
          (d) =>
            d.name.toLowerCase() !== dept.name.toLowerCase() &&
            (!dept.id || !d.id || d.id !== dept.id)
        )
      );
    } else {
      onChange([...selectedDepartments, dept]);
    }
  };

  const handleRemove = (dept: DepartmentOption) => {
    onChange(
      selectedDepartments.filter(
        (d) =>
          d.name.toLowerCase() !== dept.name.toLowerCase() &&
          (!dept.id || !d.id || d.id !== dept.id)
      )
    );
  };

  const handleClearAll = () => {
    onChange([]);
  };

  // Filter available departments based on faculty & search query
  const visibleDepartments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allDepartments.filter((dept) => {
      // Faculty filter
      if (selectedFaculty !== 'all' && dept.facultyName !== selectedFaculty) {
        return false;
      }
      // Search query
      if (q) {
        const matchesName = dept.name.toLowerCase().includes(q);
        const matchesFaculty = dept.facultyName.toLowerCase().includes(q);
        if (!matchesName && !matchesFaculty) return false;
      }
      return true;
    });
  }, [allDepartments, selectedFaculty, searchQuery]);

  const handleSelectAllVisible = () => {
    const toAdd = visibleDepartments.filter((d) => !isSelected(d));
    if (toAdd.length > 0) {
      onChange([...selectedDepartments, ...toAdd]);
    }
  };

  const handleDeselectAllVisible = () => {
    const visibleNames = new Set(visibleDepartments.map((d) => d.name.toLowerCase()));
    onChange(selectedDepartments.filter((d) => !visibleNames.has(d.name.toLowerCase())));
  };

  return (
    <div className="dept-assigner-container" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="dept-assigner-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#1b382b', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Building2 size={18} color="#0B6B3A" />
            <span>Assign Departments {required && <span style={{ color: '#d32f2f' }}>*</span>}</span>
          </h4>
          <p style={{ margin: '3px 0 0 0', fontSize: '13px', color: '#55675b' }}>
            Select one or multiple departments across faculties that should access this material.
          </p>
        </div>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: '16px',
            backgroundColor: selectedDepartments.length > 0 ? '#eaf3ec' : '#f5f5f5',
            color: selectedDepartments.length > 0 ? '#0B6B3A' : '#777',
            border: `1px solid ${selectedDepartments.length > 0 ? '#cbe3d1' : '#ddd'}`
          }}
        >
          {selectedDepartments.length} assigned
        </span>
      </div>

      {/* Selected Departments Chips */}
      <div
        style={{
          background: '#f9fbf9',
          border: '1px solid #e1ece3',
          borderRadius: '8px',
          padding: '12px',
          minHeight: '48px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: selectedDepartments.length > 0 ? '8px' : '0' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#33483b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Selected Departments ({selectedDepartments.length})
          </span>
          {selectedDepartments.length > 1 && (
            <button
              type="button"
              onClick={handleClearAll}
              style={{ background: 'none', border: 'none', color: '#c62828', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              Remove all
            </button>
          )}
        </div>

        {selectedDepartments.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#888', fontStyle: 'italic', padding: '4px 0' }}>
            No departments assigned yet. Use the selector below to assign this material to one or more departments.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {selectedDepartments.map((dept) => (
              <span
                key={dept.id || dept.name}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: '#eaf3ec',
                  border: '1px solid #cbe3d1',
                  color: '#12603d',
                  padding: '5px 10px',
                  borderRadius: '16px',
                  fontSize: '12px',
                  fontWeight: 600
                }}
              >
                <span>{dept.name}</span>
                {dept.facultyName && (
                  <span style={{ fontSize: '11px', color: '#3f785b', fontWeight: 500 }}>
                    ({dept.facultyName.replace(/^Faculty of\s+/i, '')})
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(dept)}
                  title={`Remove ${dept.name}`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#12603d',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'grid',
                    placeItems: 'center',
                    marginLeft: '2px'
                  }}
                  aria-label={`Remove ${dept.name}`}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c62828', fontSize: '13px', fontWeight: 500 }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Filter Controls: Faculty Selection & Department Search */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#444', marginBottom: '4px' }}>
            Filter by Faculty:
          </label>
          <div style={{ position: 'relative' }}>
            <select
              value={selectedFaculty}
              onChange={(e) => setSelectedFaculty(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cddcd2',
                backgroundColor: '#fff',
                fontSize: '13px',
                color: '#222'
              }}
            >
              <option value="all">All Faculties ({availableFaculties.length})</option>
              {availableFaculties.map((fac) => (
                <option key={fac} value={fac}>
                  {fac}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#444', marginBottom: '4px' }}>
            Search Departments:
          </label>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#888' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. Computer Science, Accounting, Biology..."
              style={{
                width: '100%',
                padding: '8px 12px 8px 32px',
                borderRadius: '6px',
                border: '1px solid #cddcd2',
                fontSize: '13px',
                backgroundColor: '#fff'
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#888'
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Available Departments Selection Box */}
      <div
        style={{
          border: '1px solid #e1ece3',
          borderRadius: '8px',
          background: '#fff',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
            backgroundColor: '#f6f9f7',
            borderBottom: '1px solid #e1ece3',
            fontSize: '12px'
          }}
        >
          <span style={{ fontWeight: 600, color: '#4b6154' }}>
            Available Departments ({visibleDepartments.length})
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={handleSelectAllVisible}
              style={{ background: 'none', border: 'none', color: '#0B6B3A', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              Select all visible
            </button>
            <span style={{ color: '#ccc' }}>|</span>
            <button
              type="button"
              onClick={handleDeselectAllVisible}
              style={{ background: 'none', border: 'none', color: '#666', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              Deselect visible
            </button>
          </div>
        </div>

        <div
          style={{
            maxHeight: '220px',
            overflowY: 'auto',
            padding: '8px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '6px'
          }}
        >
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#777', gridColumn: '1 / -1' }}>
              Loading departments…
            </div>
          ) : visibleDepartments.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontStyle: 'italic', gridColumn: '1 / -1' }}>
              No departments found matching your criteria.
            </div>
          ) : (
            visibleDepartments.map((dept) => {
              const checked = isSelected(dept);
              return (
                <label
                  key={dept.id || dept.name}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    backgroundColor: checked ? '#edf7f0' : 'transparent',
                    border: `1px solid ${checked ? '#b7dfc3' : '#f0f3f1'}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggle(dept)}
                    style={{ marginTop: '2px', accentColor: '#0B6B3A', cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: checked ? 600 : 500, color: checked ? '#0B6B3A' : '#222', lineHeight: '1.2' }}>
                      {dept.name}
                    </div>
                    {dept.facultyName && (
                      <div style={{ fontSize: '11px', color: '#6a7d71', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {dept.facultyName}
                      </div>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
