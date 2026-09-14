import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  X,
  Check,
  Building2,
  Layers,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ChevronDown,
  Sparkles
} from 'lucide-react';
import { fetchDepartmentCatalogue, type DepartmentOption } from '../lib/materials';
import { catalogue } from '../data/catalogue';

export interface DepartmentAssignerProps {
  /** Current selection (controlled). */
  selectedDepartments: DepartmentOption[];
  onChange: (selected: DepartmentOption[]) => void;
  error?: string | null;
  required?: boolean;
  /**
   * Pre-existing assignments. When provided the widget treats the flow as an
   * edit and visually separates "already assigned" from "newly added (pending)"
   * and sandwiches a Save/ revert diff bar.
   */
  initialDepartments?: DepartmentOption[];
}

const shortFaculty = (name: string) =>
  name.replace(/^Faculty\s+(of\s+)?/i, '').replace(/\s+College\s*$/i, '').trim();

export function DepartmentAssigner({
  selectedDepartments,
  onChange,
  error,
  required = true,
  initialDepartments
}: DepartmentAssignerProps) {
  const [allDepartments, setAllDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFaculty, setSelectedFaculty] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showPicker, setShowPicker] = useState(true);

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

  const isEdit = initialDepartments !== undefined;

  const availableFaculties = useMemo(() => {
    const set = new Set<string>();
    for (const d of allDepartments) {
      if (d.facultyName) set.add(d.facultyName);
    }
    return Array.from(set).sort();
  }, [allDepartments]);

  const deptKey = (d: DepartmentOption) => `${d.id || d.name}`.toLowerCase();

  const selectedKeySet = useMemo(() => {
    const keys = new Set<string>();
    for (const d of selectedDepartments) keys.add(deptKey(d));
    return keys;
  }, [selectedDepartments]);

  const initialKeySet = useMemo(() => {
    const keys = new Set<string>();
    for (const d of initialDepartments ?? []) keys.add(deptKey(d));
    return keys;
  }, [initialDepartments]);

  const isSelected = (dept: DepartmentOption) => selectedKeySet.has(deptKey(dept));
  const wasAssigned = (dept: DepartmentOption) => initialKeySet.has(deptKey(dept));

  const newCount = useMemo(
    () => selectedDepartments.filter((d) => !wasAssigned(d)).length,
    [selectedDepartments, initialKeySet]
  );
  const removedCount = useMemo(
    () => (initialDepartments ?? []).filter((d) => !isSelected(d)).length,
    [initialDepartments, selectedKeySet]
  );
  const hasChanges = newCount > 0 || removedCount > 0;

  const handleToggle = (dept: DepartmentOption) => {
    if (isSelected(dept)) {
      onChange(selectedDepartments.filter((d) => deptKey(d) !== deptKey(dept)));
    } else {
      onChange([...selectedDepartments, dept]);
    }
  };

  const handleRemove = (dept: DepartmentOption) => {
    onChange(selectedDepartments.filter((d) => deptKey(d) !== deptKey(dept)));
  };

  const handleClearAll = () => onChange([]);

  const handleRevert = () => onChange([...(initialDepartments ?? [])]);

  const visibleDepartments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allDepartments.filter((dept) => {
      if (selectedFaculty !== 'all' && dept.facultyName !== selectedFaculty) return false;
      if (q) {
        const matchesName = dept.name.toLowerCase().includes(q);
        const matchesFaculty = (dept.facultyName || '').toLowerCase().includes(q);
        if (!matchesName && !matchesFaculty) return false;
      }
      return true;
    });
  }, [allDepartments, selectedFaculty, searchQuery]);

  const visibleSelectedCount = useMemo(
    () => visibleDepartments.filter((d) => isSelected(d)).length,
    [visibleDepartments, selectedKeySet]
  );
  const allVisibleSelected =
    visibleDepartments.length > 0 && visibleSelectedCount === visibleDepartments.length;

  const handleSelectAllVisible = () => {
    const toAdd = visibleDepartments.filter((d) => !isSelected(d));
    if (toAdd.length > 0) onChange([...selectedDepartments, ...toAdd]);
  };

  const handleDeselectAllVisible = () => {
    const visibleKeys = new Set(visibleDepartments.map((d) => deptKey(d)));
    onChange(selectedDepartments.filter((d) => !visibleKeys.has(deptKey(d))));
  };

  return (
    <div className="da-shell">
      {/* ── Header ── */}
      <div className="da-header">
        <div className="da-heading">
          <div className="da-heading-icon">
            <Building2 size={20} />
          </div>
          <div>
            <h4 className="da-heading-title">
              Assign Departments{required && <span className="da-req">*</span>}
              {isEdit && <span className="da-tag assigned">Edit mode</span>}
            </h4>
            <p className="da-heading-sub">
              Select one or many departments across faculties that should access this material.
            </p>
          </div>
        </div>
        <span className={`da-count-pill${selectedDepartments.length > 0 ? ' has-value' : ''}`}>
          <Layers size={13} />
          {selectedDepartments.length} assigned
        </span>
      </div>

      {/* ── Selected departments (compact card grid) ── */}
      <div className="da-selected-card">
        <div className="da-selected-head">
          <div className="da-selected-head-left">
            <Sparkles size={14} className="da-selected-head-icon" />
            <span className="da-selected-label">
              Selected Departments
            </span>
            <span className="da-selected-count">{selectedDepartments.length}</span>
          </div>
          {selectedDepartments.length > 0 && (
            <button type="button" className="da-chips-clear" onClick={handleClearAll}>
              Clear all
            </button>
          )}
        </div>

        {selectedDepartments.length === 0 ? (
          <div className="da-chips-empty">
            No departments assigned yet — choose from the picker below.
          </div>
        ) : (
          <div className="da-selected-grid">
            {selectedDepartments.map((dept) => {
              const isNew = isEdit && !wasAssigned(dept);
              return (
                <div
                  key={deptKey(dept)}
                  className={`da-selected-item${isNew ? ' is-new' : ''}`}
                >
                  <div className="da-selected-item-info">
                    <Building2 size={15} className="da-selected-item-icon" />
                    <div className="da-selected-item-text">
                      <span className="da-selected-item-name">{dept.name}</span>
                      {dept.facultyName && (
                        <span className="da-selected-item-fac">{shortFaculty(dept.facultyName)}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="da-selected-item-remove"
                    onClick={() => handleRemove(dept)}
                    aria-label={`Remove ${dept.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {isEdit && selectedDepartments.length > 0 && (
          <div className="da-chips-change">
            {newCount > 0 ? `${newCount} newly added` : 'No new departments added'} ·{' '}
            {removedCount > 0
              ? `${removedCount} previously assigned marked for removal`
              : 'No removals'}
          </div>
        )}
      </div>

      {error && (
        <div className="da-error">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* ── Department picker toggle ── */}
      <button
        type="button"
        className="da-picker-toggle"
        onClick={() => setShowPicker(!showPicker)}
      >
        <span className="da-picker-toggle-text">
          <Search size={15} />
          {showPicker ? 'Hide department picker' : 'Browse & select departments'}
        </span>
        <ChevronDown
          size={16}
          className={`da-picker-toggle-chevron${showPicker ? ' open' : ''}`}
        />
      </button>

      {/* ── Picker panel ── */}
      {showPicker && (
        <div className="da-picker-panel">
          {/* ── Toolbar ── */}
          <div className="da-toolbar">
            <div className="da-toolbar-field">
              <label htmlFor="da-faculty">Filter by faculty</label>
              <select
                id="da-faculty"
                className="form-input"
                value={selectedFaculty}
                onChange={(e) => setSelectedFaculty(e.target.value)}
              >
                <option value="all">All Faculties ({availableFaculties.length})</option>
                {availableFaculties.map((fac) => (
                  <option key={fac} value={fac}>
                    {shortFaculty(fac)}
                  </option>
                ))}
              </select>
            </div>

            <div className="da-toolbar-field">
              <label htmlFor="da-search">Search departments</label>
              <div className="da-search-wrap">
                <Search size={15} className="da-search-icon" />
                <input
                  id="da-search"
                  type="text"
                  className="form-input da-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="e.g. Computer Science, Accounting…"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="da-search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="da-toolbar-actions">
              <button
                type="button"
                className="da-bulk-btn"
                onClick={handleSelectAllVisible}
                disabled={visibleDepartments.length === 0 || allVisibleSelected}
              >
                <CheckCircle2 size={14} /> Select all
              </button>
              <button
                type="button"
                className="da-bulk-btn"
                onClick={handleDeselectAllVisible}
                disabled={visibleSelectedCount === 0}
              >
                <X size={14} /> Clear visible
              </button>
            </div>
          </div>

          {/* ── Picklist ── */}
          <div className="da-picklist">
            <div className="da-picklist-head">
              <span className="da-picklist-count">
                Available <span>({visibleDepartments.length})</span>
              </span>
              <span className="da-picklist-hint">
                {visibleSelectedCount} of {visibleDepartments.length} shown selected
              </span>
            </div>

            <div className="da-picklist-body">
              {loading ? (
                <div className="da-loading">
                  <Loader2 size={22} />
                  <span>Loading departments…</span>
                </div>
              ) : visibleDepartments.length === 0 ? (
                <div className="da-empty">
                  <Search size={26} />
                  <strong>No departments found</strong>
                  <span>Try a different faculty filter or search term.</span>
                </div>
              ) : (
                visibleDepartments.map((dept) => {
                  const checked = isSelected(dept);
                  const assignedBefore = wasAssigned(dept);
                  const tagLabel = !checked
                    ? 'Will be removed'
                    : assignedBefore
                      ? 'Already assigned'
                      : 'Selected';
                  const tagClass = !checked
                    ? 'remove'
                    : assignedBefore
                      ? 'assigned'
                      : 'selected';
                  return (
                    <label
                      key={deptKey(dept)}
                      className={`da-row${checked ? ' checked' : ''}`}
                    >
                      <span className="da-check">
                        <input
                          type="checkbox"
                          className="da-check-input"
                          checked={checked}
                          onChange={() => handleToggle(dept)}
                          aria-label={`Assign ${dept.name}`}
                        />
                        <span className="da-check-box">
                          <Check size={14} strokeWidth={3} />
                        </span>
                      </span>
                      <span className="da-row-main">
                        <span className="da-row-title">{dept.name}</span>
                        <span className="da-row-sub">
                          {dept.facultyName && (
                            <span className="da-tag faculty">{shortFaculty(dept.facultyName)}</span>
                          )}
                          {isEdit && (checked || assignedBefore) && (
                            <span className={`da-tag ${tagClass}`}>{tagLabel}</span>
                          )}
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Pending-diff footer (edit flows only) ── */}
      {isEdit && hasChanges && (
        <div className="da-diff">
          <Layers size={15} />
          <span>
            You're changing assignments from <b>{(initialDepartments ?? []).length}</b> to{' '}
            <b>{selectedDepartments.length}</b>. Save to apply.
          </span>
          <button type="button" className="da-diff-revert" onClick={handleRevert}>
            Revert changes
          </button>
        </div>
      )}
    </div>
  );
}
