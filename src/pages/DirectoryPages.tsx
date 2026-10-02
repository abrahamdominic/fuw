import React, { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BookOpen,
  Building2,
  ChevronRight,
  Clock,
  GraduationCap,
  Layers,
  Search
} from 'lucide-react';
import { SEO } from '../components/SEO';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { NotFoundPage } from './NotFoundPage';
import { COLLEGE_OF_HEALTH_SCIENCES, type Department, type SemesterKey } from '../data/catalogue';
import {
  DIRECTORY_TOTALS,
  countCourses,
  courseEntries,
  departmentEntries,
  departmentSlug,
  facultySlug,
  findCourseByCode,
  findDepartmentBySlug,
  findFacultyBySlug,
  shortFacultyName,
  type CourseEntry
} from '../lib/seo/directory';
import { courseMeta, departmentMeta, facultyMeta } from '../lib/seo/dynamic';
import { UNIVERSITY_NAME } from '../lib/seo/site';

const LEVEL_WORDS: Record<number, string> = {
  100: '100 level',
  200: '200 level',
  300: '300 level',
  400: '400 level',
  500: '500 level',
  600: '600 level'
};

const SEMESTER_ORDER: SemesterKey[] = ['First Semester', 'Second Semester'];

function levelWord(level: number): string {
  return LEVEL_WORDS[level] || `${level} level`;
}

/** Distinct course codes a set of departments lists in their curriculum. */
function courseCodesFor(departments: Department[]): Set<string> {
  const codes = new Set<string>();
  for (const department of departments) {
    for (const sems of Object.values(department.curriculum || {})) {
      for (const list of Object.values(sems || {})) {
        for (const course of list || []) codes.add(course.code.trim().toUpperCase());
      }
    }
  }
  return codes;
}

function levelsForDepartments(departments: Department[]): number[] {
  const levels = new Set<number>();
  for (const department of departments) {
    for (const key of Object.keys(department.curriculum || {})) {
      const level = Number(key);
      if (!Number.isNaN(level)) levels.add(level);
    }
  }
  return Array.from(levels).sort((a, b) => a - b);
}

/** Deep link into the catalogue search, preserving the app's filter shape. */
function libraryLink(parts: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parts)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/library?${qs}` : '/library';
}

// =====================================================================
// FACULTY DETAIL  —  /faculties/:slug
// =====================================================================

export function FacultyDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const faculty = useMemo(() => findFacultyBySlug(slug), [slug]);

  const courseList = useMemo<CourseEntry[]>(() => {
    if (!faculty) return [];
    const codes = courseCodesFor(faculty.departments);
    return courseEntries().filter((c) => codes.has(c.code));
  }, [faculty]);

  if (!faculty) return <NotFoundPage />;

  const meta = facultyMeta(faculty);
  const short = shortFacultyName(faculty.name);
  const departmentCount = faculty.departments.length;
  const courseCount = faculty.departments.reduce((acc, d) => acc + countCourses(d), 0);
  const levels = levelsForDepartments(faculty.departments);

  const intro = faculty.college
    ? `${faculty.name} is one of the ${DIRECTORY_TOTALS.healthSciencesFaculties} faculties in the ${COLLEGE_OF_HEALTH_SCIENCES} of ${UNIVERSITY_NAME}, Wukari, Taraba State. It runs ${departmentCount} accredited department${departmentCount === 1 ? '' : 's'} covering ${courseCount} course${courseCount === 1 ? '' : 's'}.`
    : `${faculty.name} is an accredited faculty of ${UNIVERSITY_NAME}, Wukari, Taraba State, Nigeria. It runs ${departmentCount} accredited department${departmentCount === 1 ? '' : 's'} covering ${courseCount} course${courseCount === 1 ? '' : 's'} at ${levels.map(levelWord).join(', ')}.`;

  return (
    <main className="faculties public-container">
      <SEO
        meta={meta}
        schemaItems={faculty.departments.map((d) => ({
          name: d.name,
          path: `/departments/${departmentSlug(d)}`
        }))}
      />
      <Breadcrumbs trail={meta.breadcrumbs} />

      <p className="kicker">FEDERAL UNIVERSITY WUKARI · FACULTY</p>
      <h1>{faculty.name}</h1>
      <p className="subtitle">{intro}</p>

      <div className="info-grid">
        <section>
          <Building2 size={28} />
          <h2>Departments in this faculty</h2>
          <p>
            {departmentCount} accredited department{departmentCount === 1 ? '' : 's'}:{' '}
            {faculty.departments.map((d) => d.name).join(', ')}. Each one has its own course list and published
            materials.
          </p>
        </section>
        <section>
          <GraduationCap size={28} />
          <h2>Courses and levels</h2>
          <p>
            {courseCount} curriculum course{courseCount === 1 ? '' : 's'} at {levels.map(levelWord).join(', ')}.{' '}
            <a href="#faculty-courses">See the full course list below.</a>
          </p>
        </section>
        <section>
          <Layers size={28} />
          <h2>Academic materials</h2>
          <p>
            Lecture notes, handouts, projects and test &amp; exam past questions for {short} are published in the{' '}
            <Link to={libraryLink({ faculty: faculty.name })}>FUW E-Library catalogue</Link>.
          </p>
        </section>
      </div>

      <div className="section-head" style={{ padding: '0 1rem', marginTop: '2rem' }}>
        <div>
          <p className="kicker">DIRECTORY</p>
          <h2>Departments in {short}</h2>
        </div>
        <Link to="/faculties" className="view-all-link">
          All faculties <ChevronRight size={17} />
        </Link>
      </div>

      <div className="faculty-list">
        <section className="faculty-section-card">
          <div className="dept-links-grid">
            {faculty.departments.map((d) => (
              <DepartmentCard key={d.name} department={d} facultyName={faculty.name} />
            ))}
          </div>
        </section>
      </div>

      <div className="section-head" style={{ padding: '0 1rem', marginTop: '2rem' }}>
        <div>
          <p className="kicker">CURRICULUM</p>
          <h2 id="faculty-courses">Courses offered by {short}</h2>
        </div>
        <Link to="/courses" className="view-all-link">
          Full course directory <ChevronRight size={17} />
        </Link>
      </div>
      <p style={{ color: '#617366', fontSize: '14px' }}>
        Each course code is a permanent page listing its level, semester and the departments that offer it, with a direct
        link to the materials published under that code.
      </p>
      <div className="dept-links-grid" style={{ marginTop: '12px' }}>
        {courseList.map((c) => (
          <Link key={c.code} to={c.path} className="dept-link-item">
            <span>
              <b className="course-code-highlight">{c.code}</b> {c.title}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}

function DepartmentCard({ department, facultyName }: { department: Department; facultyName: string }) {
  const levels = levelsForDepartments([department]);
  return (
    <Link to={`/departments/${departmentSlug(department)}`} className="dept-link-item">
      <span>
        <b>{department.name}</b> · {shortFacultyName(facultyName)} · {department.duration}-year programme ·{' '}
        {levels.map(levelWord).join(', ')}
      </span>
      <span className="duration-pill">{countCourses(department)} courses</span>
    </Link>
  );
}

// =====================================================================
// DEPARTMENT DETAIL  —  /departments/:slug
// =====================================================================

export function DepartmentDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const entry = useMemo(() => findDepartmentBySlug(slug), [slug]);

  if (!entry) return <NotFoundPage />;

  const meta = departmentMeta(entry);
  const { department, faculty } = entry;
  const levels = Object.entries(department.curriculum || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const courseCount = entry.courseCount || countCourses(department);
  const levelLabels = levels.map(([level]) => levelWord(Number(level)));

  return (
    <main className="courses-page public-container">
      <SEO
        meta={meta}
        schemaItems={levels.flatMap(([levelKey, sems]) =>
          SEMESTER_ORDER.flatMap((semester) =>
            ((sems as Partial<Record<SemesterKey, { code: string; name: string }[]>>)?.[semester] ?? []).map(
              (course) => ({
                name: `${course.code} ${course.name}`,
                path: `/courses/${course.code.trim().toLowerCase()}`
              })
            )
          )
        )}
      />
      <Breadcrumbs trail={meta.breadcrumbs} />

      <p className="kicker">{shortFacultyName(faculty.name).toUpperCase()} · DEPARTMENT</p>
      <h1>{department.name}</h1>
      <p className="subtitle">
        {department.name} is a {department.duration}-year department of {faculty.name} at {UNIVERSITY_NAME}, Wukari,
        Taraba State, Nigeria. The curriculum below lists all {courseCount} course{courseCount === 1 ? '' : 's'} in the
        department by level and semester, alongside the lecture notes, handouts and past questions published for them.
      </p>

      <div className="info-grid">
        <section>
          <Building2 size={28} />
          <h2>Parent faculty</h2>
          <p>
            <Link to={`/faculties/${facultySlug(faculty)}`}>{faculty.name}</Link>
            {faculty.college ? ` — one of the faculties in the ${faculty.college}.` : '.'}
          </p>
        </section>
        <section>
          <Clock size={28} />
          <h2>Programme structure</h2>
          <p>
            {department.duration} years covering {levelLabels.join(', ')}.
          </p>
        </section>
        <section>
          <BookOpen size={28} />
          <h2>Published materials</h2>
          <p>
            <Link to={libraryLink({ faculty: faculty.name, department: department.name })}>
              Browse {department.name} materials
            </Link>{' '}
            in the FUW E-Library catalogue.
          </p>
        </section>
      </div>

      <div className="section-head" style={{ padding: '0 1rem', marginTop: '2rem' }}>
        <div>
          <p className="kicker">CURRICULUM</p>
          <h2>{department.name} courses by level and semester</h2>
        </div>
        <Link to="/courses" className="view-all-link">
          Course directory <ChevronRight size={17} />
        </Link>
      </div>

      <div className="table">
        <div className="tr head courses-table-grid dept-courses-grid">
          <span>Course Code</span>
          <span>Course Name</span>
          <span>Level</span>
          <span>Semester</span>
          <span>Materials</span>
        </div>
        {levels.flatMap(([levelKey, sems]) =>
          SEMESTER_ORDER.flatMap((semester) => {
            const list = (sems as Record<string, { code: string; name: string }[]>)?.[semester] || [];
            return list.map((course) => (
              <div className="tr courses-table-grid dept-courses-grid" key={`${levelKey}-${semester}-${course.code}`}>
                <span>
                  <Link to={`/courses/${course.code.trim().toLowerCase()}`} className="course-code-highlight">
                    {course.code}
                  </Link>
                </span>
                <span>{course.name}</span>
                <span>{levelWord(Number(levelKey))}</span>
                <span>{semester}</span>
                <span>
                  <Link
                    to={libraryLink({
                      faculty: faculty.name,
                      department: department.name,
                      level: `${levelKey} Level`,
                      semester,
                      q: course.code
                    })}
                    className="table-action-btn"
                  >
                    Browse Files
                  </Link>
                </span>
              </div>
            ));
          })
        )}
      </div>

      <div className="section-head" style={{ padding: '0 1rem', marginTop: '2rem' }}>
        <div>
          <p className="kicker">RELATED</p>
          <h2>Other departments in {shortFacultyName(faculty.name)}</h2>
        </div>
      </div>
      <div className="dept-links-grid">
        {departmentEntries()
          .filter((e) => e.faculty.name === faculty.name && e.department.name !== department.name)
          .map((e) => (
            <Link key={e.path} to={e.path} className="dept-link-item">
              <span>{e.department.name}</span>
              <span className="duration-pill">{e.department.duration} yrs</span>
            </Link>
          ))}
      </div>
    </main>
  );
}

// =====================================================================
// COURSE DETAIL  —  /courses/:code
// =====================================================================

export function CourseDetailPage() {
  const { code = '' } = useParams<{ code: string }>();
  const entry = useMemo(() => findCourseByCode(code), [code]);

  if (!entry) return <NotFoundPage />;

  const meta = courseMeta(entry);
  const departments = Array.from(
    new Map(entry.occurrences.map((o) => [o.department.name, o])).values()
  ).sort((a, b) => a.department.name.localeCompare(b.department.name));
  const facultyNames = Array.from(new Set(entry.occurrences.map((o) => o.faculty.name)));

  const where =
    departments.length === 1
      ? `the ${departments[0].department.name} department of ${facultyNames[0]}`
      : `${departments.length} departments across ${facultyNames.length} faculties`;

  return (
    <main className="detail public-container">
      <SEO
        meta={meta}
        schemaItems={departments.map((o) => ({
          name: o.department.name,
          path: `/departments/${departmentSlug(o.department)}`
        }))}
      />
      <Breadcrumbs trail={meta.breadcrumbs} />

      <span className="pill-badge green">Course</span>
      <h1>
        <span className="course-code-highlight">{entry.code}</span> {entry.title}
      </h1>
      <p className="subtitle">
        {entry.code} ({entry.title}) is part of the {UNIVERSITY_NAME} curriculum, listed in {where}. It is taken at{' '}
        {entry.levels.map(levelWord).join(' and ')}, and the FUW E-Library groups the lecture notes, handouts, projects
        and test &amp; exam past questions published under this code on one page.
      </p>

      <dl className="detail-meta-list">
        <dt>Course code</dt>
        <dd>{entry.code}</dd>
        <dt>Course title</dt>
        <dd>{entry.title}</dd>
        <dt>Levels</dt>
        <dd>{entry.levels.map(levelWord).join(', ')}</dd>
        <dt>Semesters</dt>
        <dd>{entry.semesters.join(', ')}</dd>
        <dt>Offered by</dt>
        <dd>{departments.length === 1 ? `${departments[0].department.name}, ${facultyNames[0]}` : facultyNames.join(' · ')}</dd>
        <dt>University</dt>
        <dd>{UNIVERSITY_NAME}, Wukari, Taraba State, Nigeria</dd>
      </dl>

      <div className="section-head" style={{ padding: '0 1rem', marginTop: '2rem' }}>
        <div>
          <p className="kicker">WHERE IT IS OFFERED</p>
          <h2>Departments offering {entry.code}</h2>
        </div>
        <Link to="/courses" className="view-all-link">
          All courses <ChevronRight size={17} />
        </Link>
      </div>

      <div className="dept-links-grid">
        {departments.map(({ department, faculty, level, semester }) => (
          <Link
            key={`${department.name}-${level}-${semester}`}
            to={`/departments/${departmentSlug(department)}`}
            className="dept-link-item"
          >
            <span>
              <b>{department.name}</b> · {shortFacultyName(faculty.name)} · {levelWord(level)} · {semester}
            </span>
            <ChevronRight size={15} aria-hidden="true" />
          </Link>
        ))}
      </div>

      <div className="section-head" style={{ padding: '0 1rem', marginTop: '2rem' }}>
        <div>
          <p className="kicker">MATERIALS</p>
          <h2>Study materials for {entry.code}</h2>
        </div>
      </div>
      <p style={{ color: '#617366', fontSize: '14px' }}>
        Jump straight to the published files for this course code. The catalogue filters on the exact code, so you do
        not have to sift through the whole collection.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '12px' }}>
        <Link to={libraryLink({ q: entry.code })} className="primary">
          <Search size={16} /> Search the catalogue for {entry.code}
        </Link>
        {departments.slice(0, 6).map(({ department, faculty }) => (
          <Link
            key={department.name}
            to={libraryLink({ faculty: faculty.name, department: department.name, q: entry.code })}
            className="secondary-btn"
          >
            {department.name} materials
          </Link>
        ))}
      </div>
    </main>
  );
}