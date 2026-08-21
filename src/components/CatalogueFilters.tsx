import React from 'react';
import { catalogue, materialTypes, levelsFor, facultyByName, departmentByName } from '../data/catalogue';

export interface FilterState {
  faculty: string;
  department: string;
  course: string;
  level: string;
  semester: string;
  type: string;
}

interface CatalogueFiltersProps {
  filters?: FilterState;
  onChange?: (filters: FilterState) => void;
  compact?: boolean;
}

export function CatalogueFilters({ filters, onChange, compact = false }: CatalogueFiltersProps) {
  // If controlled
  const [internalFilters, setInternalFilters] = React.useState<FilterState>({
    faculty: '',
    department: '',
    course: '',
    level: '',
    semester: '',
    type: ''
  });

  const state = filters || internalFilters;

  const updateField = (field: keyof FilterState, value: string) => {
    let nextState = { ...state, [field]: value };
    if (field === 'faculty') {
      nextState.department = '';
      nextState.course = '';
      nextState.level = '';
    } else if (field === 'department') {
      nextState.course = '';
      nextState.level = '';
    }

    if (onChange) {
      onChange(nextState);
    } else {
      setInternalFilters(nextState);
    }
  };

  const currentFaculty = facultyByName(state.faculty);
  const currentDepartment = departmentByName(state.faculty, state.department);
  const availableLevels = levelsFor(currentDepartment?.duration || 4);

  return (
    <div className={compact ? 'catalogue-form' : 'catalogue-filters'}>
      <label>
        Faculty
        <select
          name="faculty"
          value={state.faculty}
          onChange={(e) => updateField('faculty', e.target.value)}
        >
          <option value="">All faculties</option>
          {catalogue.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Department
        <select
          name="department"
          value={state.department}
          disabled={!state.faculty}
          onChange={(e) => updateField('department', e.target.value)}
        >
          <option value="">{state.faculty ? 'All departments' : 'Select faculty first'}</option>
          {currentFaculty?.departments.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Course
        <select
          name="course"
          value={state.course}
          disabled={!state.department}
          onChange={(e) => updateField('course', e.target.value)}
        >
          <option value="">{state.department ? 'All courses' : 'Select department first'}</option>
          {currentDepartment?.courses.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Level
        <select
          name="level"
          value={state.level}
          disabled={!state.department}
          onChange={(e) => updateField('level', e.target.value)}
        >
          <option value="">{state.department ? 'All levels' : 'Select department first'}</option>
          {availableLevels.map((lvl) => (
            <option key={lvl} value={lvl}>
              {lvl}
            </option>
          ))}
        </select>
      </label>

      <label>
        Semester
        <select
          name="semester"
          value={state.semester}
          onChange={(e) => updateField('semester', e.target.value)}
        >
          <option value="">All semesters</option>
          <option value="First Semester">First Semester</option>
          <option value="Second Semester">Second Semester</option>
        </select>
      </label>

      <label>
        Material Type
        <select
          name="type"
          value={state.type}
          onChange={(e) => updateField('type', e.target.value)}
        >
          <option value="">All material types</option>
          {['Lecture Note', 'Textbook', 'Past Questions', ...materialTypes].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
