import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Check,
  ChevronDown,
  Building2,
  Layers,
  Minus,
  Plus,
  AlertCircle,
  Loader2,
  X
} from 'lucide-react';
import { fetchDepartmentCatalogue, type DepartmentOption } from '../lib/materials';
import { catalogue } from '../data/catalogue';

/**
 * Managed state for the multi-department upload question.
 *
 *   enabled           – student answered "Yes, other departments also offer this course"
 *   count             – number of ADDITIONAL departments to choose (1..MAX_EXTRA_DEPARTMENTS)
 *   departments       – the selected additional departments (length <= count)
 *   primaryDepartmentId – resolved UUID of the student's own department (empty when the
 *                         database catalogue is unavailable and only the name fallback works)
 */
export interface MultiDepartmentState {
  enabled: boolean;
  count: number;
  departments: DepartmentOption[];
  primaryDepartmentId?: string;
}

export const EMPTY_MULTI_DEPARTMENT: MultiDepartmentState = {
  enabled: false,
  count: 1,
  departments: []
};

const MAX_EXTRA_DEPARTMENTS = 6;

interface MultiDepartmentPickerProps {
  /** The uploader's own department (primary) which must never be selectable as an extra. */
  ownDepartment: string;
  value: MultiDepartmentState;
  onChange: (next: MultiDepartmentState) => void;
  disabled?: boolean;
  /** Only render the question UI once the primary department has been chosen. */
  ready?: boolean;
}

const shortFaculty = (name: string) =>
  name.replace(/^Faculty\s+(of\s+)?/i, '').replace(/\s+College\s*$/i, '').trim();

export function MultiDepartmentPicker({
  ownDepartment,
  value,
  onChange,
  disabled = false,
  ready = true
}: MultiDepartmentPickerProps) {
  const [allDepartments, setAllDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [slotSearch, setSlotSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchDepartmentCatalogue()
      .then((depts) => {
        if (!cancelled) {
          setAllDepartments(depts);
          setLoading(false);

          // Resolve the primary department id once the catalogue arrives.
          const own = ownDepartment
            ? depts.find((d) => d.name.trim().toLowerCase() === ownDepartment.trim().toLowerCase())
            : undefined;
          const ownId = own && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(own.id) ? own.id : undefined;
          onChange({ ...value, primaryDepartmentId: ownId });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownDepartment]);

  const ownName = ownDepartment.trim().toLowerCase();
  const isUuid = (id?: string) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  const deptKey = (d: DepartmentOption) => (d.id || d.name).toLowerCase();

  // Options for a specific slot: everything except the student's own department
  // and the departments already picked in other slots.
  const availableFor = (index: number): DepartmentOption[] => {
    const pickedElsewhere = new Set(
      value.departments.map((d, i) => (i === index ? null : d && deptKey(d))).filter(Boolean) as string[]
    );
    const q = (openSlot === index ? slotSearch.trim().toLowerCase() : '');
    return allDepartments.filter((d) => {
      // Never allow the student's own department as an extra department.
      if (d.name.trim().toLowerCase() === ownName) return false;
      if (pickedElsewhere.has(deptKey(d))) return false;
      if (q) {
        const nameHit = d.name.toLowerCase().includes(q);
        const facHit = (d.facultyName || '').toLowerCase().includes(q);
        if (!nameHit && !facHit) return false;
      }
      return true;
    });
  };

  const handleEnable = (enabled: boolean) => {
    onChange({ ...value, enabled, departments: enabled ? value.departments : [] });
    setOpenSlot(null);
    setSlotSearch('');
  };

  const handleCountChange = (nextCount: number) => {
    const clamped = Math.min(MAX_EXTRA_DEPARTMENTS, Math.max(1, nextCount));
    onChange({ ...value, count: clamped, departments: value.departments.slice(0, clamped) });
    setOpenSlot(null);
    setSlotSearch('');
  };

  const handleSelect = (index: number, dept: DepartmentOption) => {
    const departments = [...value.departments];
    departments[index] = dept;
    onChange({ ...value, departments });
    setOpenSlot(null);
    setSlotSearch('');
  };

  const handleRemove = (index: number) => {
    const departments = value.departments.filter((_, i) => i !== index);
    onChange({
      ...value,
      count: Math.max(1, value.count - 1),
      departments
    });
    setOpenSlot(null);
    setSlotSearch('');
  };

  const openSlotFor = (index: number) => {
    if (disabled) return;
    setOpenSlot((current) => (current === index ? null : index));
    setSlotSearch('');
  };

  return (
    <div className={`md-shell${value.enabled ? ' is-enabled' : ''}`}>
      <div className="md-heading">
        <div className="md-heading-icon">
          <Building2 size={19} />
        </div>
        <div>
          <h4 className="md-heading-title">Multi-Department Availability</h4>
          <p className="md-heading-sub">
            Let students in other departments find this material if the course is shared across the university.
          </p>
        </div>
      </div>

      {!ready ? (
        <p className="md-not-ready">Choose your department above first.</p>
      ) : (
        <>
          <p className="md-question">
            Is this course offered by other departments besides <b>{ownDepartment || 'your department'}</b>?
          </p>

          <div className="md-options" role="radiogroup" aria-label="Is this course offered by other departments?">
            <button
              type="button"
              role="radio"
              aria-checked={!value.enabled}
              disabled={disabled}
              className={`md-option${!value.enabled ? ' active' : ''}`}
              onClick={() => handleEnable(false)}
            >
              <span className={`md-option-radio${!value.enabled ? ' checked' : ''}`}>
                {!value.enabled && <Check size={13} strokeWidth={3} />}
              </span>
              <span>
                <b>No, only my department</b>
                <small>Students in {ownDepartment || 'your department'} only can view this material.</small>
              </span>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={value.enabled}
              disabled={disabled}
              className={`md-option${value.enabled ? ' active' : ''}`}
              onClick={() => handleEnable(true)}
            >
              <span className={`md-option-radio${value.enabled ? ' checked' : ''}`}>
                {value.enabled && <Check size={13} strokeWidth={3} />}
              </span>
              <span>
                <b>Yes, other departments also offer this course</b>
                <small>The material will be shared with students in those departments too.</small>
              </span>
            </button>
          </div>

          {value.enabled && (
            <div className="md-body">
              <div className="md-count-row">
                <label htmlFor="md-count" className="md-count-label">
                  How many other departments offer this course?
                </label>
                <div className="md-stepper">
                  <button
                    type="button"
                    className="md-stepper-btn"
                    disabled={disabled || value.count <= 1}
                    onClick={() => handleCountChange(value.count - 1)}
                    aria-label="Fewer additional departments"
                  >
                    <Minus size={15} />
                  </button>
                  <span className="md-stepper-value">{value.count}</span>
                  <button
                    type="button"
                    className="md-stepper-btn"
                    disabled={disabled || value.count >= MAX_EXTRA_DEPARTMENTS}
                    onClick={() => handleCountChange(value.count + 1)}
                    aria-label="More additional departments"
                  >
                    <Plus size={15} />
                  </button>
                </div>
              </div>

              <div className="md-slots">
                {Array.from({ length: value.count }, (_, i) => {
                  const selected = value.departments[i] || null;
                  const options = availableFor(i);
                  const hasError = !!selected && !isUuid(selected.id);
                  return (
                    <div key={i} className="md-slot">
                      <div className="md-slot-head">
                        <span className="md-slot-index">{i + 1}</span>
                        <span className="md-slot-title">Additional Department {i + 1}</span>
                        {selected && (
                          <button
                            type="button"
                            className="md-slot-clear"
                            onClick={() => handleRemove(i)}
                            aria-label={`Clear department ${i + 1}`}
                          >
                            <X size={14} />
                          </button>
                        )}
                        <span className="md-slot-count">
                          <Layers size={12} /> {selected ? 'Selected' : `${options.length} available`}
                        </span>
                      </div>

                      <div className="md-drop">
                        <button
                          type="button"
                          className={`md-drop-trigger${selected ? ' has-value' : ''}${openSlot === i ? ' open' : ''}${hasError ? ' has-error' : ''}`}
                          disabled={disabled}
                          onClick={() => openSlotFor(i)}
                          aria-haspopup="listbox"
                          aria-expanded={openSlot === i}
                        >
                          {selected ? (
                            <span className="md-drop-value">
                              <Building2 size={15} />
                              <b>{selected.name}</b>
                              {selected.facultyName && (
                                <small>{shortFaculty(selected.facultyName)}</small>
                              )}
                            </span>
                          ) : (
                            <span className="md-drop-placeholder">
                              <Search size={15} />
                              Select department {i + 1}
                            </span>
                          )}
                          <ChevronDown size={16} className={`md-drop-chevron${openSlot === i ? ' open' : ''}`} />
                        </button>

                        {openSlot === i && (
                          <>
                            <div
                              className="md-drop-backdrop"
                              onClick={() => openSlotFor(i)}
                              aria-hidden
                            />
                            <div className="md-drop-panel" role="listbox" aria-label={`Select additional department ${i + 1}`}>
                              <div className="md-drop-search">
                                <Search size={14} />
                                <input
                                  type="text"
                                  autoFocus
                                  value={slotSearch}
                                  onChange={(e) => setSlotSearch(e.target.value)}
                                  placeholder="Search departments or faculty…"
                                  aria-label="Search departments"
                                />
                              </div>
                              <div className="md-drop-list">
                                {options.length === 0 ? (
                                  <p className="md-drop-empty">
                                    {loading ? 'Loading departments…' : 'No other departments available to select.'}
                                  </p>
                                ) : (
                                  options.map((d) => {
                                    const checked = selected && deptKey(selected) === deptKey(d);
                                    return (
                                      <button
                                        key={deptKey(d)}
                                        type="button"
                                        role="option"
                                        aria-selected={checked}
                                        className={`md-drop-item${checked ? ' selected' : ''}`}
                                        onClick={() => handleSelect(i, d)}
                                      >
                                        <span className="md-drop-check">{checked && <Check size={13} strokeWidth={3} />}</span>
                                        <span className="md-drop-item-main">
                                          <b>{d.name}</b>
                                          {d.facultyName && <small>{shortFaculty(d.facultyName)}</small>}
                                        </span>
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      {hasError && (
                        <p className="md-slot-error">
                          <AlertCircle size={13} /> This department could not be verified in the database — re-select it from the list.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="md-note">
                Your own department (<b>{ownDepartment || '—'}</b>) is always included and cannot be selected below.
              </p>

              {loading && (
                <p className="md-loading">
                  <Loader2 size={14} /> Syncing department list…
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}