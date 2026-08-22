// =====================================================================
// FUW E-Library — Official Course Catalogue
// Canonical source for faculty -> department -> level -> semester ->
// course relationships. Common/university-wide courses are expanded
// automatically into every applicable department (without duplication).
// =====================================================================

export type SemesterKey = 'First Semester' | 'Second Semester';

export interface Course {
  code: string;
  name: string;
}

export interface FlatCourse extends Course {
  level: number;
  semester: SemesterKey;
  department: string;
  faculty: string;
}

export interface Department {
  name: string;
  duration: 4 | 5 | 6;
  /** Flat, legacy-compatible course list (all levels & semesters merged). */
  courses: FlatCourse[];
  /** Structured curriculum: level number -> semester key -> courses. */
  curriculum: Partial<Record<number, Partial<Record<SemesterKey, Course[]>>>>;
}

export interface Faculty {
  name: string;
  /** Parent college for grouped faculties (e.g. College of Health Sciences). */
  college?: string;
  departments: Department[];
}

// ---------------------------------------------------------------------
// Material types ("Test Questions" renamed to "Test Past Questions";
// "Textbook" removed entirely per university policy).
// ---------------------------------------------------------------------
export const materialTypes = ['Test Past Questions', 'Exam Past Questions', 'Projects', 'Handouts'];

/** Maps legacy material-type labels to their current canonical labels. */
const LEGACY_TYPE_MAP: Record<string, string> = {
  'Test Questions': 'Test Past Questions',
  Textbook: 'Lecture Note',
  'E-Book / Text': 'Lecture Note'
};

/** Normalize any stored/legacy material type to its current label. */
export function normalizeMaterialType(type?: string | null): string {
  if (!type) return 'Lecture Note';
  return LEGACY_TYPE_MAP[type] || type;
}

// ---------------------------------------------------------------------
// Shared / common course definitions
// ---------------------------------------------------------------------

const C = (code: string, name: string): Course => ({ code, name });

/** Every 100-level department in the university. */
const COMMON_100_ALL: Record<SemesterKey, Course[]> = {
  'First Semester': [C('GST111C', 'Communication in English 1')],
  'Second Semester': [C('GST112C', 'Nigerian Peoples Culture & Citizenship')]
};

/** Every 100-level science-based department (incl. Agriculture faculty). */
const COMMON_100_SCIENCE: Record<SemesterKey, Course[]> = {
  'First Semester': [
    C('MTH101C', 'Elementary Mathematics I'),
    C('PHY101C', 'General Physics I'),
    C('PHY107C', 'General Physics Practical I')
  ],
  'Second Semester': [
    C('MTH102C', 'Elementary Mathematics II'),
    C('PHY102C', 'General Physics II'),
    C('PHY108C', 'General Physics Practical II')
  ]
};

/** Every department at 300 level and above (university-wide GST courses). */
const COMMON_300_ALL: Record<SemesterKey, Course[]> = {
  'First Semester': [C('GST311C', 'Introduction to Entrepreneurial Skills')],
  'Second Semester': [C('GST312', 'Peace & Conflict Resolution')]
};

const SCIENCE_FACULTIES = new Set([
  'Faculty of Agriculture & Life Sciences',
  'Faculty of Bio-Sciences',
  'Faculty of Physical Sciences',
  'Faculty of Computing & Information System'
]);

// ---------------------------------------------------------------------
// Faculty-specific curricula (exact course codes & titles as approved)
// ---------------------------------------------------------------------

interface DeptSpec {
  name: string;
  duration: 4 | 5 | 6;
  /** level -> semester -> explicit department courses */
  curriculum?: Partial<Record<number, Partial<Record<SemesterKey, Course[]>>>>;
  /** Legacy flat entries kept from previous catalogue versions. */
  legacy?: Array<[string, string, number, SemesterKey?]>;
}

const MICROBIOLOGY_100: Required<Record<SemesterKey, Course[]>> = {
  'First Semester': [
    C('BIO101C', 'General Biology I'),
    C('BIO107C', 'General Biology Practical I'),
    C('CHM101C', 'General Chemistry I'),
    C('CHM107C', 'General Chemistry Practical I'),
    C('COS101C', 'Introduction to Computing Science'),
    C('GST111C', 'Communication in English 1'),
    C('MTH101C', 'Elementary Mathematics I'),
    C('PHY101C', 'General Physics I'),
    C('PHY107C', 'General Physics Practical I')
  ],
  'Second Semester': [
    C('BIO102C', 'General Biology II'),
    C('BIO108C', 'General Biology Practical II'),
    C('CHM102C', 'General Chemistry II'),
    C('CHM108C', 'General Chemistry Practical II'),
    C('GST112C', 'Nigerian Peoples Culture & Citizenship'),
    C('MCB102F', 'Introductory Microbiology'),
    C('MTH102C', 'Elementary Mathematics II'),
    C('PHY102C', 'General Physics II'),
    C('PHY108C', 'General Physics Practical II')
  ]
};

const COMPUTER_SCIENCE_100: Required<Record<SemesterKey, Course[]>> = {
  'First Semester': [
    C('COS101C', 'Introduction to Computing Sciences'),
    C('CSC103F', 'Fundamental of Programming Languages'),
    C('CSC105F', 'Computer Appreciation'),
    C('CSC107F', 'Introduction to Information Technology'),
    C('GST107', 'Use of Library, Study Skills and Information and Communication Technology (ICT)'),
    C('GST111C', 'Communication in English 1'),
    C('MTH101C', 'Elementary Mathematics I'),
    C('PHY101C', 'General Physics I'),
    C('PHY107C', 'General Physics Practical I'),
    C('STA111C', 'Discriptive Statistics')
  ],
  'Second Semester': [
    C('COS102C', 'Problem Solving'),
    C('CSC104F', 'Hardware System & Maintenance'),
    C('CSC106F', 'Introduction to Programming Language'),
    C('CSC108F', 'Introduction to File Processing and Management'),
    C('GST108', 'Communication in French'),
    C('GST112C', 'Nigerian Peoples Culture & Citizenship'),
    C('MTH102C', 'Elementary Mathematics II'),
    C('PHY102C', 'General Physics II'),
    C('PHY108C', 'General Physics Practical II'),
    C('STA122C', 'Statistical Computing I')
  ]
};

const SOCIOLOGY_300: Required<Record<SemesterKey, Course[]>> = {
  'First Semester': [
    C('GST311C', 'Introduction to Entrepreneurial Skills'),
    C('SOC301C', 'Methods of Social Research Statistics'),
    C('SOC303C', 'Sociology of Crime and Delinquency'),
    C('SOC305C', 'Political Sociology'),
    C('SOC307C', 'Organizational Behaviour'),
    C('SSC301', 'Innovation in the Social Sciences')
  ],
  'Second Semester': [
    C('GST312', 'Peace & Conflict Resolution'),
    C('GST312C', 'Venture Creation'),
    C('SOC302C', 'Social Inequality'),
    C('SOC306C', 'Formal Organisations'),
    C('SOC308C', 'Group Dynamics and Intergroup Relations'),
    C('SOC310C', 'Rural Sociology'),
    C('SOC312C', 'Demography and Population Studies'),
    C('SOC314C', 'Sociology of Medicine, Health and Illness'),
    C('SSC302', 'Research Method I')
  ]
};

// ---------------------------------------------------------------------
// Catalogue definition
// ---------------------------------------------------------------------

interface FacultySpec {
  name: string;
  /** Parent college for grouped faculties (e.g. College of Health Sciences). */
  college?: string;
  departments: DeptSpec[];
}

const FACULTY_SPECS: FacultySpec[] = [
  {
    name: 'Faculty of Bio-Sciences',
    departments: [
      { name: 'Biochemistry', duration: 4 },
      { name: 'Biology/Biological Sciences', duration: 4 },
      { name: 'Biotechnology', duration: 4 },
      { name: 'Botany', duration: 4 },
      { name: 'Microbiology', duration: 4, curriculum: { 100: MICROBIOLOGY_100 } },
      { name: 'Zoology', duration: 4 }
    ]
  },
  {
    name: 'Faculty of Computing & Information System',
    departments: [
      { name: 'Computer Science', duration: 4, curriculum: { 100: COMPUTER_SCIENCE_100 } },
      { name: 'Information Technology', duration: 4 },
      { name: 'Information Systems', duration: 4 },
      { name: 'Cyber Security', duration: 4 },
      { name: 'Software Engineering', duration: 4 }
    ]
  },
  {
    name: 'Faculty of Social Sciences',
    departments: [
      { name: 'Sociology', duration: 4, curriculum: { 300: SOCIOLOGY_300 } },
      { name: 'Economics', duration: 4 },
      { name: 'Library & Information Science', duration: 4 },
      { name: 'Political Science', duration: 4 }
    ]
  },
  {
    // Agriculture students take the same science foundation courses as the
    // science faculties (handled by COMMON_100_SCIENCE below).
    name: 'Faculty of Agriculture & Life Sciences',
    departments: [
      { name: 'Agricultural Economics & Extension', duration: 5 },
      { name: 'Animal Production & Health', duration: 5 },
      { name: 'Crop Production & Protection', duration: 5 },
      { name: 'Fisheries & Aquaculture', duration: 5 },
      { name: 'Food Science & Technology', duration: 5 },
      { name: 'Forestry & Wildlife Management', duration: 5 },
      { name: 'Soil Science & Land Resources Management', duration: 5 }
    ]
  },
  {
    name: 'Faculty of Physical Sciences',
    departments: [
      { name: 'Chemistry', duration: 4 },
      { name: 'Industrial Chemistry', duration: 4 },
      { name: 'Mathematics', duration: 4 },
      { name: 'Pure & Applied Physics', duration: 4 },
      { name: 'Statistics', duration: 4 }
    ]
  },
  {
    name: 'Faculty of Education',
    departments: [
      { name: 'Educational Foundations', duration: 4 },
      { name: 'Curriculum Studies', duration: 4 },
      { name: 'Educational Psychology', duration: 4 },
      { name: 'Guidance & Counselling', duration: 4 },
      { name: 'Science & Technical Education', duration: 4 },
      { name: 'Chemistry Education', duration: 4 },
      { name: 'Mathematics Education', duration: 4 },
      { name: 'Physics Education', duration: 4 }
    ]
  },
  {
    name: 'Faculty of Engineering',
    departments: [
      { name: 'Agricultural Engineering', duration: 5 },
      { name: 'Chemical Engineering', duration: 5 },
      { name: 'Civil Engineering', duration: 5 },
      { name: 'Computer Engineering', duration: 5 },
      { name: 'Mechanical Engineering', duration: 5 }
    ]
  },
  {
    name: 'Faculty of Humanities',
    departments: [
      { name: 'African Traditional Religion', duration: 4 },
      { name: 'Christian Religious Studies', duration: 4 },
      { name: 'English & Literary Studies', duration: 4 },
      { name: 'History & Diplomatic Studies', duration: 4 },
      { name: 'Islamic Religious Studies', duration: 4 },
      { name: 'Philosophy', duration: 4 }
    ]
  },
  {
    name: 'Faculty of Law',
    departments: [
      { name: 'Public & International Law', duration: 5 },
      { name: 'Private & Commercial Law', duration: 5 }
    ]
  },
  {
    name: 'Faculty of Management Sciences',
    departments: [
      { name: 'Accounting', duration: 4 },
      { name: 'Banking & Finance', duration: 4 },
      { name: 'Business Administration', duration: 4 },
      { name: 'Hospitality & Tourism Management', duration: 4 },
      { name: 'Public Administration', duration: 4 }
    ]
  },
  // The College of Health Sciences is a parent category containing four
  // faculties; each keeps its existing department durations.
  {
    name: 'Faculty of Basic Medical Sciences',
    college: 'College of Health Sciences',
    departments: [
      { name: 'Human Anatomy', duration: 4 },
      { name: 'Human Physiology', duration: 4 }
    ]
  },
  {
    name: 'Faculty of Allied Health Sciences',
    college: 'College of Health Sciences',
    departments: [
      { name: 'Medical Laboratory Science', duration: 5 },
      { name: 'Physiotherapy', duration: 5 }
    ]
  },
  {
    name: 'Faculty of Clinical Sciences',
    college: 'College of Health Sciences',
    departments: [
      { name: 'Medicine', duration: 6 },
      { name: 'Surgery', duration: 6 },
      { name: 'Community Medicine', duration: 6 },
      { name: 'Family Medicine', duration: 6 },
      { name: 'Paediatrics', duration: 6 }
    ]
  },
  {
    name: 'Faculty of Basic Clinical Sciences',
    college: 'College of Health Sciences',
    departments: [
      { name: 'Medical Biochemistry', duration: 4 },
      { name: 'Chemical Pathology', duration: 4 },
      { name: 'Histopathology', duration: 4 },
      { name: 'Haematology', duration: 4 },
      { name: 'Pharmacology/Therapeutics', duration: 4 }
    ]
  }
];
// ---------------------------------------------------------------------
// Catalogue builder — expands commons + de-duplicates by course code
// ---------------------------------------------------------------------

function buildCurriculum(
  deptName: string,
  facultyName: string,
  spec: DeptSpec
): { curriculum: Department['curriculum']; flat: FlatCourse[] } {
  const isScience = SCIENCE_FACULTIES.has(facultyName);
  const curriculum: Department['curriculum'] = {};
  const flat: FlatCourse[] = [];
  const seen = new Set<string>();

  const push = (level: number, semester: SemesterKey, course: Course) => {
    const key = `${level}|${semester}|${course.code.toUpperCase()}`;
    if (seen.has(key)) return; // never duplicate a course entry
    seen.add(key);
    if (!curriculum[level]) curriculum[level] = {};
    const bucket = curriculum[level]!;
    bucket[semester] = [...(bucket[semester] || []), course];
    flat.push({ ...course, level, semester, department: deptName, faculty: facultyName });
  };

  // 1. Department-specific curriculum always wins.
  if (spec.curriculum) {
    for (const [lvl, semesters] of Object.entries(spec.curriculum)) {
      const level = Number(lvl);
      for (const semester of ['First Semester', 'Second Semester'] as SemesterKey[]) {
        (semesters as Record<string, Course[]>)[semester]?.forEach((c) => push(level, semester, c));
      }
    }
  }

  // 2. University-wide 100-level commons.
  if ((spec.duration >= 4)) {
    COMMON_100_ALL['First Semester'].forEach((c) => push(100, 'First Semester', c));
    COMMON_100_ALL['Second Semester'].forEach((c) => push(100, 'Second Semester', c));

    // 3. Science-faculty 100-level mathematics & physics (Agriculture included).
    if (isScience) {
      COMMON_100_SCIENCE['First Semester'].forEach((c) => push(100, 'First Semester', c));
      COMMON_100_SCIENCE['Second Semester'].forEach((c) => push(100, 'Second Semester', c));
    }
  }

  // 4. University-wide 300-level GST commons for every department offering 300 level.
  if (spec.duration >= 3) {
    COMMON_300_ALL['First Semester'].forEach((c) => push(300, 'First Semester', c));
    COMMON_300_ALL['Second Semester'].forEach((c) => push(300, 'Second Semester', c));
  }

  return { curriculum, flat };
}

function buildCatalogue(): Faculty[] {
  return FACULTY_SPECS.map((f) => ({
    name: f.name,
    ...(f.college ? { college: f.college } : {}),
    departments: f.departments.map((d) => {
      const { curriculum, flat } = buildCurriculum(d.name, f.name, d);
      return { name: d.name, duration: d.duration, courses: flat, curriculum };
    })
  }));
}

export const catalogue: Faculty[] = buildCatalogue();

// ---------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------

export const COLLEGE_OF_HEALTH_SCIENCES = 'College of Health Sciences';

/**
 * Faculties grouped by their parent college. Standalone faculties come
 * first (college: null), then each college with its member faculties.
 */
export function groupedFaculties(): Array<{ college: string | null; faculties: Faculty[] }> {
  const groups: Array<{ college: string | null; faculties: Faculty[] }> = [];
  for (const f of catalogue) {
    const key = f.college ?? null;
    let group = groups.find((g) => g.college === key);
    if (!group) {
      group = { college: key, faculties: [] };
      groups.push(group);
    }
    group.faculties.push(f);
  }
  // Standalone faculties first, colleges afterwards (stable order).
  return groups.sort((a, b) => Number(a.college !== null) - Number(b.college !== null));
}

/** Normalize any stored level value ("1000 Level", "10000 Level"…) to "100 Level". */
export function normalizeLevel(level?: string | null): string {
  if (!level) return '';
  const m = level.trim().match(/^([1-6])0{2,4}\s*Level$/i);
  if (m) return `${m[1]}00 Level`;
  return level.trim();
}

export const levelsFor = (duration?: number): string[] =>
  Array.from({ length: Math.max(0, duration ?? 0) }, (_, i) => `${i + 1}00 Level`);

export const facultyByName = (name?: string | null): Faculty | undefined =>
  catalogue.find((f) => f.name === name);

export const departmentByName = (faculty?: string | null, department?: string | null): Department | undefined =>
  facultyByName(faculty)?.departments.find((d) => d.name === department);

export const parseLevelNumber = (level?: string | null): number | null => {
  if (!level) return null;
  const n = parseInt(level.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Returns the exact course list for a faculty/department/level/semester
 * selection. Courses are only ever drawn from that department's own
 * curriculum for the requested level & semester.
 */
export function getCoursesForSelection(
  faculty?: string | null,
  department?: string | null,
  level?: string | null,
  semester?: string | null
): Course[] {
  const dept = departmentByName(faculty, department);
  if (!dept) return [];
  const lvl = parseLevelNumber(level);
  if (!lvl) return [];

  const levelBucket = dept.curriculum[lvl];
  if (!levelBucket) return [];

  const semesters: SemesterKey[] =
    semester === 'First Semester' || semester === 'Second Semester'
      ? [semester]
      : ['First Semester', 'Second Semester'];

  return semesters.flatMap((s) => levelBucket[s] || []);
}

/**
 * Validates a full academic classification for a material upload.
 * A course may only be assigned to its own department/level/semester.
 */
export function isValidCourseAssignment(opts: {
  faculty?: string | null;
  department?: string | null;
  level?: string | null;
  semester?: string | null;
  courseCode?: string | null;
}): boolean {
  const { faculty, department, level, semester, courseCode } = opts;
  if (!faculty || !department || !level || !courseCode) return false;
  const dept = departmentByName(faculty, department);
  if (!dept) return false;
  const lvl = parseLevelNumber(level);
  if (!lvl) return false;
  if (!dept.curriculum[lvl]) return false;
  if (semester !== 'First Semester' && semester !== 'Second Semester') return false;

  const code = courseCode.trim().toUpperCase();
  return getCoursesForSelection(faculty, department, level, semester).some(
    (c) => c.code.trim().toUpperCase() === code
  );
}

/** Best-effort official title lookup for a course code (any faculty). */
const GLOBAL_COURSE_INDEX: Map<string, string> = (() => {
  const index = new Map<string, string>();
  for (const f of catalogue) {
    for (const d of f.departments) {
      for (const c of d.courses) {
        const key = c.code.trim().toUpperCase();
        if (!index.has(key)) index.set(key, c.name);
      }
    }
  }
  return index;
})();

export function courseTitleByCode(code?: string | null): string | undefined {
  if (!code) return undefined;
  return GLOBAL_COURSE_INDEX.get(code.trim().toUpperCase());
}

/** All unique departments across every faculty (with parent faculty). */
export const allDepartments = (): Array<{ faculty: string; name: string; duration: 4 | 5 | 6 }> =>
  catalogue.flatMap((f) =>
    f.departments.map((d) => ({ faculty: f.name, name: d.name, duration: d.duration }))
  );

/** Flat list of every course instance across the whole university. */
export const allCoursesFlat = (): FlatCourse[] => catalogue.flatMap((f) => f.departments.flatMap((d) => d.courses));
