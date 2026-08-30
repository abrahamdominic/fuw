import React from 'react';
import {
  materialTypes,
  levelsFor,
  facultyByName,
  departmentByName,
  getCoursesForSelection,
  groupedFaculties,
  type Course
} from '../data/catalogue';

// Hierarchy: Faculty → Department → Level → Semester → Material Type → Course.
export interface FilterState {
  faculty: string;
  department: string;
  level: string;
  semester: string;
  type: string;
  course: string;
}

export const EMPTY_FILTERS: FilterState = {
  faculty: '',
  department: '',
  level: '',
  semester: '',
  type: '',
  course: ''
};

type FilterField = keyof FilterState;

const FIELD_LABELS: Record<FilterField, string> = {
  faculty: 'Faculty',
  department: 'Department',
  level: 'Level',
  semester: 'Semester',
  type: 'Material Type',
  course: 'Course'
};

/** Cascade order — each field depends on every field before it. */
const CASCADE_ORDER: FilterField[] = ['faculty', 'department', 'level', 'semester', 'type', 'course'];

/**
 * Reset every dependent selection after `field` in the hierarchy so an
 * invalid combination can never exist.
 */
function cascadeFrom(field: FilterField, value: string, prev: FilterState): FilterState {
  const next = { ...prev, [field]: value };
  const idx = CASCADE_ORDER.indexOf(field);
  for (const dependent of CASCADE_ORDER.slice(idx + 1)) {
    next[dependent] = '';
  }
  return next;
}

interface CatalogueFiltersProps {
  filters?: FilterState;
  onChange?: (filters: FilterState) => void;
  compact?: boolean;
  /** Subset of fields to render (always rendered in cascade order). Defaults to all. */
  fields?: FilterField[];
}

export function CatalogueFilters({ filters, onChange, compact = false, fields }: CatalogueFiltersProps) {
  // If controlled
  const [internalFilters, setInternalFilters] = React.useState<FilterState>(EMPTY_FILTERS);
  // Database-merged course options for the selected academic structure
  // (includes courses admins publish directly to the catalogue).
  const [mergedCourses, setMergedCourses] = React.useState<Course[] | null>(null);

  const state = filters || internalFilters;

  const updateField = (field: FilterField, value: string) => {
    const nextState = cascadeFrom(field, value, state);
    if (onChange) {
      onChange(nextState);
    } else {
      setInternalFilters(nextState);
    }
  };

  const visibleFields = fields ? CASCADE_ORDER.filter((f) => fields.includes(f)) : CASCADE_ORDER;

  const currentFaculty = facultyByName(state.faculty);
  const currentDepartment = departmentByName(state.faculty, state.department);

  // Levels are restricted to the selected department's programme duration.
  const availableLevels = state.department ? levelsFor(currentDepartment?.duration) : [];

  // Courses only ever come from the exact department + level + semester combo.
  const staticCourses =
    state.department && state.level && state.semester
      ? getCoursesForSelection(state.faculty, state.department, state.level, state.semester)
      : [];

  // Refresh the merged course list whenever the academic structure changes.
  React.useEffect(() => {
    setMergedCourses(null);
    if (state.department && state.level && state.semester) {
      let cancelled = false;
      import('../lib/liveCatalogue')
        .then((m) => m.getMergedCoursesForSelection(state.faculty, state.department, state.level, state.semester))
        .then((list) => {
          if (!cancelled) setMergedCourses(list);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
  }, [state.faculty, state.department, state.level, state.semester]);

  const availableCourses = mergedCourses ?? staticCourses;

  // A field unlocks once every rendered field ahead of it in the hierarchy
  // has a value (skipped fields cannot block their dependents).
  const isEnabled = (field: FilterField): boolean => {
    const idx = visibleFields.indexOf(field);
    return visibleFields.slice(0, idx).every((f) => !!state[f]);
  };

  /** Label of the closest unmet parent requirement (null when unlocked). */
  const lockedBy = (field: FilterField): string | null => {
    const idx = visibleFields.indexOf(field);
    for (let i = idx - 1; i >= 0; i--) {
      if (!state[visibleFields[i]]) return FIELD_LABELS[visibleFields[i]];
    }
    return null;
  };

  const renderSelect = (field: FilterField) => {
    const label = FIELD_LABELS[field];
    const enabled = isEnabled(field);
    const parent = lockedBy(field);

    let options: React.ReactNode = null;
    switch (field) {
      case 'faculty':
        options = groupedFaculties().map((group) =>
          group.college ? (
            <optgroup key={group.college} label={group.college}>
              {group.faculties.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          ) : (
            group.faculties.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))
          )
        );
        break;
      case 'department':
        options = currentFaculty?.departments.map((d) => (
          <option key={d.name} value={d.name}>
            {d.name}
          </option>
        ));
        break;
      case 'level':
        options = availableLevels.map((lvl) => (
          <option key={lvl} value={lvl}>
            {lvl}
          </option>
        ));
        break;
      case 'semester':
        options = (
          <>
            <option value="First Semester">First Semester</option>
            <option value="Second Semester">Second Semester</option>
          </>
        );
        break;
      case 'type':
        options = materialTypes.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ));
        break;
      case 'course':
        options =
          availableCourses.length > 0 ? (
            availableCourses.map((c, i) => (
              <option key={`${c.code}-${i}`} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))
          ) : (
            <option value="" disabled>
              No catalogued courses for this combination
            </option>
          );
        break;
    }

    // Placeholder wording: locked → which parent is needed first; empty →
    // "Select X"; after a choice is made → an escape hatch back to "All".
    const placeholder = parent
      ? `Select ${parent} first`
      : state[field]
        ? `All ${label}${label.endsWith('e') ? 's' : ''}`
        : `Select ${label}`;

    return (
      <label key={field}>
        {label}
        <select
          name={field}
          value={state[field]}
          disabled={!enabled}
          onChange={(e) => updateField(field, e.target.value)}
        >
          <option value="">{placeholder}</option>
          {enabled && options}
        </select>
      </label>
    );
  };

  return (
    <div className={compact ? 'catalogue-form' : 'catalogue-filters'}>
      {visibleFields.map(renderSelect)}
    </div>
  );
}