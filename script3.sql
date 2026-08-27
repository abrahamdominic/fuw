-- =====================================================================
-- FUW E-LIBRARY — script3.sql : SEED DATA / REFERENCE ROWS
-- =====================================================================
-- Run order:  script1.sql  ->  script2.sql  ->  script3.sql
--
-- Populates the database with the actual FUW E-Library data:
--   1. Levels            100 / 200 / 300 / 400 / 500 / 600  (never 1000+)
--   2. Faculties         14 faculties with corrected programme durations
--   3. Departments       66 departments under their correct faculties,
--                        with per-programme durations (Engineering 5,
--                        Agriculture 5, Law 5, Medicine 6, Med Lab Sci 5,
--                        Bachelor of Physiotherapy 6, Doctor of
--                        Physiotherapy 6 via Clinical Sciences,
--                        Anatomy 4, Physiology 4)
--   4. Courses           full catalogue incl. common-course rules:
--                          GST111C -> ALL departments at 100 Level
--                          MTH101C -> ALL 100 Level science students
--                          PHY101C -> applicable 100 Level science depts
--                        Semesters used: 'First Semester', 'Second Semester'
--   5. Material types    verified enum labels:
--                          Test Questions / Exam Past Questions /
--                          Projects / Handouts (+ legacy labels)
--   6. System settings   'maintenance' row (disabled by default)
--   7. Profile backfill  guarantees every existing auth account keeps a
--                        profile (no one is locked out after migration)
--   8. Verification      fails loudly with named problems if anything
--                        did not land correctly
--
-- Every insert is idempotent (ON CONFLICT DO NOTHING / DO UPDATE), so this
-- file can be re-run without creating duplicates or destroying data.
-- =====================================================================

-- -----------------------------------------------------------------------------
-- 1. Levels — exactly six, 100 to 600.
-- -----------------------------------------------------------------------------
INSERT INTO public.levels (name, numeric_level) VALUES
  ('100 Level', 100),
  ('200 Level', 200),
  ('300 Level', 300),
  ('400 Level', 400),
  ('500 Level', 500),
  ('600 Level', 600)
ON CONFLICT (numeric_level) DO UPDATE SET name = EXCLUDED.name;

-- -----------------------------------------------------------------------------
-- 2. Faculties — durations follow the latest approved structure.
-- -----------------------------------------------------------------------------
INSERT INTO public.faculties (name, duration_years) VALUES
  ('Faculty of Bio-Sciences', 4),
  ('Faculty of Computing & Information System', 4),
  ('Faculty of Social Sciences', 4),
  ('Faculty of Agriculture & Life Sciences', 5),
  ('Faculty of Physical Sciences', 4),
  ('Faculty of Education', 4),
  ('Faculty of Engineering', 5),
  ('Faculty of Humanities', 4),
  ('Faculty of Law', 5),
  ('Faculty of Management Sciences', 4),
  ('Faculty of Basic Medical Sciences', 4),
  ('Faculty of Allied Health Sciences', 5),
  ('Faculty of Clinical Sciences', 6),
  ('Faculty of Basic Clinical Sciences', 4)
ON CONFLICT (name) DO UPDATE SET duration_years = EXCLUDED.duration_years;

-- -----------------------------------------------------------------------------
-- 3. Departments — grouped under their correct faculty with programme
--    durations in years.
-- -----------------------------------------------------------------------------
INSERT INTO public.departments (faculty_id, name, duration_years)
SELECT fa.id, d.dept, d.dur FROM (VALUES
  ('Faculty of Bio-Sciences', 'Biochemistry', 4),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 4),
  ('Faculty of Bio-Sciences', 'Biotechnology', 4),
  ('Faculty of Bio-Sciences', 'Botany', 4),
  ('Faculty of Bio-Sciences', 'Microbiology', 4),
  ('Faculty of Bio-Sciences', 'Zoology', 4),
  ('Faculty of Computing & Information System', 'Computer Science', 4),
  ('Faculty of Computing & Information System', 'Information Technology', 4),
  ('Faculty of Computing & Information System', 'Information Systems', 4),
  ('Faculty of Computing & Information System', 'Cyber Security', 4),
  ('Faculty of Computing & Information System', 'Software Engineering', 4),
  ('Faculty of Social Sciences', 'Sociology', 4),
  ('Faculty of Social Sciences', 'Economics', 4),
  ('Faculty of Social Sciences', 'Library & Information Science', 4),
  ('Faculty of Social Sciences', 'Political Science', 4),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 5),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 5),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 5),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 5),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 5),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 5),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 5),
  ('Faculty of Physical Sciences', 'Chemistry', 4),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 4),
  ('Faculty of Physical Sciences', 'Mathematics', 4),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 4),
  ('Faculty of Physical Sciences', 'Statistics', 4),
  ('Faculty of Education', 'Educational Foundations', 4),
  ('Faculty of Education', 'Curriculum Studies', 4),
  ('Faculty of Education', 'Educational Psychology', 4),
  ('Faculty of Education', 'Guidance & Counselling', 4),
  ('Faculty of Education', 'Science & Technical Education', 4),
  ('Faculty of Education', 'Chemistry Education', 4),
  ('Faculty of Education', 'Mathematics Education', 4),
  ('Faculty of Education', 'Physics Education', 4),
  ('Faculty of Engineering', 'Agricultural Engineering', 5),
  ('Faculty of Engineering', 'Chemical Engineering', 5),
  ('Faculty of Engineering', 'Civil Engineering', 5),
  ('Faculty of Engineering', 'Computer Engineering', 5),
  ('Faculty of Engineering', 'Mechanical Engineering', 5),
  ('Faculty of Humanities', 'African Traditional Religion', 4),
  ('Faculty of Humanities', 'Christian Religious Studies', 4),
  ('Faculty of Humanities', 'English & Literary Studies', 4),
  ('Faculty of Humanities', 'History & Diplomatic Studies', 4),
  ('Faculty of Humanities', 'Islamic Religious Studies', 4),
  ('Faculty of Humanities', 'Philosophy', 4),
  ('Faculty of Law', 'Public & International Law', 5),
  ('Faculty of Law', 'Private & Commercial Law', 5),
  ('Faculty of Management Sciences', 'Accounting', 4),
  ('Faculty of Management Sciences', 'Banking & Finance', 4),
  ('Faculty of Management Sciences', 'Business Administration', 4),
  ('Faculty of Management Sciences', 'Hospitality & Tourism Management', 4),
  ('Faculty of Management Sciences', 'Public Administration', 4),
  ('Faculty of Basic Medical Sciences', 'Human Anatomy', 4),
  ('Faculty of Basic Medical Sciences', 'Human Physiology', 4),
  ('Faculty of Allied Health Sciences', 'Medical Laboratory Science', 5),
  ('Faculty of Allied Health Sciences', 'Physiotherapy', 6),
  ('Faculty of Clinical Sciences', 'Medicine', 6),
  ('Faculty of Clinical Sciences', 'Surgery', 6),
  ('Faculty of Clinical Sciences', 'Community Medicine', 6),
  ('Faculty of Clinical Sciences', 'Family Medicine', 6),
  ('Faculty of Clinical Sciences', 'Paediatrics', 6),
  ('Faculty of Basic Clinical Sciences', 'Medical Biochemistry', 4),
  ('Faculty of Basic Clinical Sciences', 'Chemical Pathology', 4),
  ('Faculty of Basic Clinical Sciences', 'Histopathology', 4),
  ('Faculty of Basic Clinical Sciences', 'Haematology', 4),
  ('Faculty of Basic Clinical Sciences', 'Pharmacology/Therapeutics', 4)
) AS d(faculty_name, dept, dur)
JOIN public.faculties fa ON fa.name = d.faculty_name
ON CONFLICT (faculty_id, name) DO UPDATE SET duration_years = EXCLUDED.duration_years;

-- -----------------------------------------------------------------------------
-- 4. Courses — full catalogue. Codes ending in 'C' are general/common
--    courses (is_general_course = TRUE automatically).
--      * GST111C / GST112C          -> every department (100 Level)
--      * MTH101C / MTH102C and the
--        PHY101C/107C/102C/108C set -> science departments (100 Level)
--      * GST311C / GST312(GST312C)  -> every department (300 Level)
--      * remaining rows             -> department-specific curricula
--    Semester values are exclusively 'First Semester' / 'Second Semester'.
-- -----------------------------------------------------------------------------
INSERT INTO public.courses (department_id, course_code, course_title, level_id, semester, is_general_course)
SELECT dep.id, c.code, c.name, lv.id, c.sem, right(c.code, 1) = 'C'
FROM (VALUES
  ('Faculty of Bio-Sciences', 'Biochemistry', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'BIO101C', 'General Biology I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'BIO107C', 'General Biology Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'CHM101C', 'General Chemistry I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'CHM107C', 'General Chemistry Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'COS101C', 'Introduction to Computing Science', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'BIO102C', 'General Biology II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'BIO108C', 'General Biology Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'CHM102C', 'General Chemistry II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'CHM108C', 'General Chemistry Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'MCB102F', 'Introductory Microbiology', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'COS101C', 'Introduction to Computing Sciences', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC103F', 'Fundamental of Programming Languages', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC105F', 'Computer Appreciation', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC107F', 'Introduction to Information Technology', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST107', 'Use of Library, Study Skills and Information and Communication Technology (ICT)', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'STA111C', 'Discriptive Statistics', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'COS102C', 'Problem Solving', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC104F', 'Hardware System & Maintenance', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC106F', 'Introduction to Programming Language', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC108F', 'Introduction to File Processing and Management', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST108', 'Communication in French', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'STA122C', 'Statistical Computing I', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC301C', 'Methods of Social Research Statistics', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC303C', 'Sociology of Crime and Delinquency', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC305C', 'Political Sociology', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC307C', 'Organizational Behaviour', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SSC301', 'Innovation in the Social Sciences', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'GST312C', 'Venture Creation', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC302C', 'Social Inequality', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC306C', 'Formal Organisations', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC308C', 'Group Dynamics and Intergroup Relations', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC310C', 'Rural Sociology', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC312C', 'Demography and Population Studies', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC314C', 'Sociology of Medicine, Health and Illness', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SSC302', 'Research Method I', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Social Sciences', 'Economics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Social Sciences', 'Economics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Social Sciences', 'Economics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Economics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Library & Information Science', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Social Sciences', 'Library & Information Science', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Social Sciences', 'Library & Information Science', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Library & Information Science', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Political Science', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Social Sciences', 'Political Science', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Social Sciences', 'Political Science', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Political Science', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'AGG101F', 'Agricultural Potentials of Taraba State', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'AGG103F', 'Agricultural Laws Policies and Reforms', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'AGG111C', 'Introduction to Agriculture I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'BIO101C', 'General Biology I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'BIO107C', 'General Biology Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'CHM101C', 'General Chemistry I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'CHM107C', 'General Chemistry Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'AGG112C', 'Introduction to Agriculture II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'BIO102C', 'General Biology II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'BIO108C', 'General Biology Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'CHM102C', 'General Chemistry II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'CHM108C', 'General Chemistry Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'AEE305C', 'Data Science and Statistical Computing', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'AEE307C', 'Introduction to Farm Management and Accounting', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'AEE311C', 'Principles of Rural Sociology', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'APH305C', 'Ruminant Animal Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'CPP301C', 'Arable Crops Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'CPP305C', 'Introduction to Crop Protection', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'SSL303C', 'Introductory Pedology and Soil Physics', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'AEE304C', 'Agricultural Laws and Reforms', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'AEE306C', 'Application of Computer to Agriculture', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'APH302C', 'Introduction to Animal Breeding and Genetics', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'APH304C', 'Non-Ruminant Animal Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'APH312C', 'Micro-Livestock Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'CPP302C', 'Permanent Crops Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'CPP304C', 'Crop Genetics and Breeding', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'GST312C', 'Venture Creation', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'SSL301C', 'Agro-Meteorology, Biogeography and Climate Change', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'SSL302C', 'Introduction to Agric. Mechanization', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'SSL304C', 'Organic Manure Production and Technology', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'AGG101F', 'Agricultural Potentials of Taraba State', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'AGG103F', 'Agricultural Laws Policies and Reforms', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'AGG111C', 'Introduction to Agriculture I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'BIO101C', 'General Biology I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'BIO107C', 'General Biology Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'CHM101C', 'General Chemistry I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'CHM107C', 'General Chemistry Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'AGG112C', 'Introduction to Agriculture II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'BIO102C', 'General Biology II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'BIO108C', 'General Biology Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'CHM102C', 'General Chemistry II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'CHM108C', 'General Chemistry Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'AEE305C', 'Data Science and Statistical Computing', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'AEE307C', 'Introduction to Farm Management and Accounting', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'AEE311C', 'Principles of Rural Sociology', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'APH305C', 'Ruminant Animal Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'CPP301C', 'Arable Crops Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'CPP305C', 'Introduction to Crop Protection', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'SSL303C', 'Introductory Pedology and Soil Physics', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'AEE304C', 'Agricultural Laws and Reforms', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'AEE306C', 'Application of Computer to Agriculture', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'APH302C', 'Introduction to Animal Breeding and Genetics', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'APH304C', 'Non-Ruminant Animal Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'APH312C', 'Micro-Livestock Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'CPP302C', 'Permanent Crops Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'CPP304C', 'Crop Genetics and Breeding', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'GST312C', 'Venture Creation', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'SSL301C', 'Agro-Meteorology, Biogeography and Climate Change', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'SSL302C', 'Introduction to Agric. Mechanization', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'SSL304C', 'Organic Manure Production and Technology', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'AGG101F', 'Agricultural Potentials of Taraba State', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'AGG103F', 'Agricultural Laws Policies and Reforms', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'AGG111C', 'Introduction to Agriculture I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'BIO101C', 'General Biology I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'BIO107C', 'General Biology Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'CHM101C', 'General Chemistry I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'CHM107C', 'General Chemistry Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'AGG112C', 'Introduction to Agriculture II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'BIO102C', 'General Biology II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'BIO108C', 'General Biology Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'CHM102C', 'General Chemistry II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'CHM108C', 'General Chemistry Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'AEE305C', 'Data Science and Statistical Computing', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'AEE307C', 'Introduction to Farm Management and Accounting', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'AEE311C', 'Principles of Rural Sociology', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'APH305C', 'Ruminant Animal Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'CPP301C', 'Arable Crops Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'CPP305C', 'Introduction to Crop Protection', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'SSL303C', 'Introductory Pedology and Soil Physics', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'AEE304C', 'Agricultural Laws and Reforms', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'AEE306C', 'Application of Computer to Agriculture', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'APH302C', 'Introduction to Animal Breeding and Genetics', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'APH304C', 'Non-Ruminant Animal Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'APH312C', 'Micro-Livestock Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'CPP302C', 'Permanent Crops Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'CPP304C', 'Crop Genetics and Breeding', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'GST312C', 'Venture Creation', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'SSL301C', 'Agro-Meteorology, Biogeography and Climate Change', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'SSL302C', 'Introduction to Agric. Mechanization', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'SSL304C', 'Organic Manure Production and Technology', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'AGG101F', 'Agricultural Potentials of Taraba State', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'AGG103F', 'Agricultural Laws Policies and Reforms', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'AGG111C', 'Introduction to Agriculture I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'BIO101C', 'General Biology I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'BIO107C', 'General Biology Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'CHM101C', 'General Chemistry I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'CHM107C', 'General Chemistry Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'AGG112C', 'Introduction to Agriculture II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'BIO102C', 'General Biology II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'BIO108C', 'General Biology Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'CHM102C', 'General Chemistry II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'CHM108C', 'General Chemistry Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'AEE305C', 'Data Science and Statistical Computing', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'AEE307C', 'Introduction to Farm Management and Accounting', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'AEE311C', 'Principles of Rural Sociology', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'APH305C', 'Ruminant Animal Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'CPP301C', 'Arable Crops Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'CPP305C', 'Introduction to Crop Protection', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'SSL303C', 'Introductory Pedology and Soil Physics', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'AEE304C', 'Agricultural Laws and Reforms', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'AEE306C', 'Application of Computer to Agriculture', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'APH302C', 'Introduction to Animal Breeding and Genetics', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'APH304C', 'Non-Ruminant Animal Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'APH312C', 'Micro-Livestock Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'CPP302C', 'Permanent Crops Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'CPP304C', 'Crop Genetics and Breeding', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'GST312C', 'Venture Creation', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'SSL301C', 'Agro-Meteorology, Biogeography and Climate Change', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'SSL302C', 'Introduction to Agric. Mechanization', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'SSL304C', 'Organic Manure Production and Technology', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'AGG101F', 'Agricultural Potentials of Taraba State', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'AGG103F', 'Agricultural Laws Policies and Reforms', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'AGG111C', 'Introduction to Agriculture I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'BIO101C', 'General Biology I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'BIO107C', 'General Biology Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'CHM101C', 'General Chemistry I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'CHM107C', 'General Chemistry Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'AGG112C', 'Introduction to Agriculture II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'BIO102C', 'General Biology II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'BIO108C', 'General Biology Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'CHM102C', 'General Chemistry II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'CHM108C', 'General Chemistry Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'AEE305C', 'Data Science and Statistical Computing', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'AEE307C', 'Introduction to Farm Management and Accounting', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'AEE311C', 'Principles of Rural Sociology', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'APH305C', 'Ruminant Animal Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'CPP301C', 'Arable Crops Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'CPP305C', 'Introduction to Crop Protection', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'SSL303C', 'Introductory Pedology and Soil Physics', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'AEE304C', 'Agricultural Laws and Reforms', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'AEE306C', 'Application of Computer to Agriculture', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'APH302C', 'Introduction to Animal Breeding and Genetics', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'APH304C', 'Non-Ruminant Animal Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'APH312C', 'Micro-Livestock Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'CPP302C', 'Permanent Crops Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'CPP304C', 'Crop Genetics and Breeding', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'GST312C', 'Venture Creation', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'SSL301C', 'Agro-Meteorology, Biogeography and Climate Change', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'SSL302C', 'Introduction to Agric. Mechanization', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'SSL304C', 'Organic Manure Production and Technology', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'AGG101F', 'Agricultural Potentials of Taraba State', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'AGG103F', 'Agricultural Laws Policies and Reforms', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'AGG111C', 'Introduction to Agriculture I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'BIO101C', 'General Biology I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'BIO107C', 'General Biology Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'CHM101C', 'General Chemistry I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'CHM107C', 'General Chemistry Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'AGG112C', 'Introduction to Agriculture II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'BIO102C', 'General Biology II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'BIO108C', 'General Biology Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'CHM102C', 'General Chemistry II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'CHM108C', 'General Chemistry Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'AEE305C', 'Data Science and Statistical Computing', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'AEE307C', 'Introduction to Farm Management and Accounting', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'AEE311C', 'Principles of Rural Sociology', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'APH305C', 'Ruminant Animal Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'CPP301C', 'Arable Crops Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'CPP305C', 'Introduction to Crop Protection', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'SSL303C', 'Introductory Pedology and Soil Physics', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'AEE304C', 'Agricultural Laws and Reforms', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'AEE306C', 'Application of Computer to Agriculture', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'APH302C', 'Introduction to Animal Breeding and Genetics', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'APH304C', 'Non-Ruminant Animal Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'APH312C', 'Micro-Livestock Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'CPP302C', 'Permanent Crops Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'CPP304C', 'Crop Genetics and Breeding', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'GST312C', 'Venture Creation', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'SSL301C', 'Agro-Meteorology, Biogeography and Climate Change', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'SSL302C', 'Introduction to Agric. Mechanization', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'SSL304C', 'Organic Manure Production and Technology', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'AGG101F', 'Agricultural Potentials of Taraba State', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'AGG103F', 'Agricultural Laws Policies and Reforms', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'AGG111C', 'Introduction to Agriculture I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'BIO101C', 'General Biology I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'BIO107C', 'General Biology Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'CHM101C', 'General Chemistry I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'CHM107C', 'General Chemistry Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'AGG112C', 'Introduction to Agriculture II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'BIO102C', 'General Biology II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'BIO108C', 'General Biology Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'CHM102C', 'General Chemistry II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'CHM108C', 'General Chemistry Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'AEE305C', 'Data Science and Statistical Computing', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'AEE307C', 'Introduction to Farm Management and Accounting', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'AEE311C', 'Principles of Rural Sociology', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'APH305C', 'Ruminant Animal Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'CPP301C', 'Arable Crops Production', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'CPP305C', 'Introduction to Crop Protection', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'SSL303C', 'Introductory Pedology and Soil Physics', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'AEE304C', 'Agricultural Laws and Reforms', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'AEE306C', 'Application of Computer to Agriculture', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'APH302C', 'Introduction to Animal Breeding and Genetics', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'APH304C', 'Non-Ruminant Animal Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'APH312C', 'Micro-Livestock Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'CPP302C', 'Permanent Crops Production', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'CPP304C', 'Crop Genetics and Breeding', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'GST312C', 'Venture Creation', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'SSL301C', 'Agro-Meteorology, Biogeography and Climate Change', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'SSL302C', 'Introduction to Agric. Mechanization', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'SSL304C', 'Organic Manure Production and Technology', 300, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Educational Foundations', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Educational Foundations', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Educational Foundations', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Educational Foundations', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Curriculum Studies', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Curriculum Studies', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Curriculum Studies', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Curriculum Studies', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Educational Psychology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Educational Psychology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Educational Psychology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Educational Psychology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Guidance & Counselling', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Guidance & Counselling', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Guidance & Counselling', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Guidance & Counselling', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Science & Technical Education', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Science & Technical Education', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Science & Technical Education', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Science & Technical Education', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Chemistry Education', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Chemistry Education', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Chemistry Education', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Chemistry Education', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Mathematics Education', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Mathematics Education', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Mathematics Education', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Mathematics Education', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Physics Education', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Physics Education', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Physics Education', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Physics Education', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Engineering', 'Agricultural Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Engineering', 'Agricultural Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Engineering', 'Agricultural Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Engineering', 'Agricultural Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Engineering', 'Chemical Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Engineering', 'Chemical Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Engineering', 'Chemical Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Engineering', 'Chemical Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Engineering', 'Civil Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Engineering', 'Civil Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Engineering', 'Civil Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Engineering', 'Civil Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Engineering', 'Computer Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Engineering', 'Computer Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Engineering', 'Computer Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Engineering', 'Computer Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Engineering', 'Mechanical Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Engineering', 'Mechanical Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Engineering', 'Mechanical Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Engineering', 'Mechanical Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'African Traditional Religion', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'African Traditional Religion', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'African Traditional Religion', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'African Traditional Religion', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'Christian Religious Studies', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'Christian Religious Studies', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'Christian Religious Studies', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'Christian Religious Studies', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'English & Literary Studies', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'English & Literary Studies', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'English & Literary Studies', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'English & Literary Studies', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'History & Diplomatic Studies', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'History & Diplomatic Studies', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'History & Diplomatic Studies', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'History & Diplomatic Studies', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'Islamic Religious Studies', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'Islamic Religious Studies', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'Islamic Religious Studies', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'Islamic Religious Studies', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'Philosophy', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'Philosophy', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'Philosophy', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'Philosophy', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Law', 'Public & International Law', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Law', 'Public & International Law', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Law', 'Public & International Law', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Law', 'Public & International Law', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Law', 'Private & Commercial Law', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Law', 'Private & Commercial Law', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Law', 'Private & Commercial Law', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Law', 'Private & Commercial Law', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Management Sciences', 'Accounting', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Management Sciences', 'Accounting', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Management Sciences', 'Accounting', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Management Sciences', 'Accounting', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Management Sciences', 'Banking & Finance', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Management Sciences', 'Banking & Finance', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Management Sciences', 'Banking & Finance', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Management Sciences', 'Banking & Finance', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Management Sciences', 'Business Administration', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Management Sciences', 'Business Administration', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Management Sciences', 'Business Administration', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Management Sciences', 'Business Administration', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Management Sciences', 'Hospitality & Tourism Management', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Management Sciences', 'Hospitality & Tourism Management', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Management Sciences', 'Hospitality & Tourism Management', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Management Sciences', 'Hospitality & Tourism Management', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Management Sciences', 'Public Administration', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Management Sciences', 'Public Administration', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Management Sciences', 'Public Administration', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Management Sciences', 'Public Administration', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Anatomy', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Anatomy', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Anatomy', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Anatomy', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Physiology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Physiology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Physiology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Physiology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Allied Health Sciences', 'Medical Laboratory Science', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Allied Health Sciences', 'Medical Laboratory Science', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Allied Health Sciences', 'Medical Laboratory Science', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Allied Health Sciences', 'Medical Laboratory Science', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Allied Health Sciences', 'Physiotherapy', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Allied Health Sciences', 'Physiotherapy', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Allied Health Sciences', 'Physiotherapy', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Allied Health Sciences', 'Physiotherapy', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Allied Health Sciences', 'Physiotherapy', 'PTY503', 'Physiotherapy in Geriatrics', 500, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Medicine', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Medicine', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Medicine', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Medicine', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Surgery', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Surgery', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Surgery', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Surgery', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Community Medicine', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Community Medicine', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Community Medicine', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Community Medicine', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Family Medicine', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Family Medicine', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Family Medicine', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Family Medicine', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Paediatrics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Paediatrics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Paediatrics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Paediatrics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Medical Biochemistry', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Medical Biochemistry', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Medical Biochemistry', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Medical Biochemistry', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Chemical Pathology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Chemical Pathology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Chemical Pathology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Chemical Pathology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Histopathology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Histopathology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Histopathology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Histopathology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Haematology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Haematology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Haematology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Haematology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Pharmacology/Therapeutics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Pharmacology/Therapeutics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Pharmacology/Therapeutics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Pharmacology/Therapeutics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester')
) AS c(faculty_name, dept_name, code, name, lvl, sem)
JOIN public.departments dep ON dep.name = c.dept_name
JOIN public.faculties fa ON fa.id = dep.faculty_id AND fa.name = c.faculty_name
JOIN public.levels lv ON lv.numeric_level = c.lvl
ON CONFLICT (department_id, course_code) DO UPDATE SET
  course_title      = EXCLUDED.course_title,
  level_id          = EXCLUDED.level_id,
  semester          = EXCLUDED.semester,
  is_general_course = EXCLUDED.is_general_course;

-- -----------------------------------------------------------------------------
-- 5. Material types.
--    Material types are stored in the public.material_type enum (created and
--    label-guarded by script1). The four canonical labels required by the
--    application are asserted again here so a failed script1 cannot slip by:
--      Test Questions / Exam Past Questions / Projects / Handouts
--    (Legacy labels 'Test Past Questions', 'Lecture Note', 'Textbook' remain
--    valid for historical rows.)
-- -----------------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(DISTINCT e.enumlabel) INTO n
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'material_type'
     AND e.enumlabel IN ('Test Questions','Exam Past Questions','Projects','Handouts');
  IF n <> 4 THEN
    RAISE EXCEPTION 'material_type enum is missing canonical labels (%/4 present)', n;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. System settings — persistent maintenance-mode row (disabled by default).
--    Existing production values are preserved (DO NOTHING on conflict).
-- -----------------------------------------------------------------------------
INSERT INTO public.system_settings (key, value)
VALUES ('maintenance', JSONB_BUILD_OBJECT('enabled', FALSE, 'message', ''))
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7. Backfill profiles for pre-existing auth accounts.
--     auth.users survives migrations, but the signup trigger only fires for
--     NEW registrations. This gives every existing auth account a matching
--     student profile (unique username derived from the email, with
--     collision-safe suffixes) so nobody is locked out after the migration.
--     Existing roles are never overwritten — only missing rows are created.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  u record;
  base text;
  candidate text;
  i int;
  created int := 0;
BEGIN
  FOR u IN
    SELECT au.id, au.email, au.last_sign_in_at
    FROM auth.users au
    WHERE au.email IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id)
  LOOP
    base := lower(regexp_replace(split_part(u.email, '@', 1), '[^a-z0-9._-]', '', 'g'));
    IF base IS NULL OR base = '' THEN
      base := 'user';
    END IF;

    candidate := base;
    i := 1;
    WHILE EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE lower(trim(p.username)) = candidate
    ) LOOP
      i := i + 1;
      candidate := base || '-' || i::text;
    END LOOP;

    INSERT INTO public.profiles (id, email, username, full_name, display_name, role, last_login_at)
    VALUES (
      u.id,
      u.email,
      candidate,
      split_part(u.email, '@', 1),
      split_part(u.email, '@', 1),
      'student'::public.app_role,
      u.last_sign_in_at
    )
    ON CONFLICT (id) DO NOTHING;

    created := created + 1;
  END LOOP;
  RAISE NOTICE 'Profile backfill finished: % auth account(s) now have a profile.', created;
END $$;

-- -----------------------------------------------------------------------------
-- 8. Seed verification — raises one clear exception naming every problem.
--     Fix before pointing the application at the database.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  problems text[] := '{}';
  n bigint;
BEGIN
  -- Faculties
  SELECT COUNT(*) INTO n FROM public.faculties;
  IF n < 14 THEN
    problems := problems || array['faculties under-seeded: ' || n || ' rows (expected >= 14)'];
  END IF;

  -- Levels: exactly six, all within 100-600
  SELECT COUNT(*) INTO n FROM public.levels;
  IF n <> 6 THEN
    problems := problems || array['levels must contain exactly the 6 rows 100-600, found ' || n];
  END IF;
  SELECT COUNT(*) INTO n FROM public.levels WHERE numeric_level NOT BETWEEN 100 AND 600;
  IF n > 0 THEN
    problems := problems || array['invalid level values present (must be 100-600 only)'];
  END IF;

  -- Departments
  SELECT COUNT(*) INTO n FROM public.departments;
  IF n < 60 THEN
    problems := problems || array['departments under-seeded: ' || n || ' rows (expected >= 60)'];
  END IF;

  -- Courses
  SELECT COUNT(*) INTO n FROM public.courses;
  IF n < 400 THEN
    problems := problems || array['courses under-seeded: ' || n || ' rows (expected >= 400)'];
  END IF;

  -- GST111C must exist for EVERY department at 100 Level
  SELECT COUNT(*) INTO n FROM public.departments d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.courses c
      WHERE c.department_id = d.id AND upper(c.course_code) = 'GST111C');
  IF n > 0 THEN
    problems := problems || array[n || ' department(s) missing GST111C'];
  END IF;

  -- MTH101C / PHY101C coverage across science departments
  SELECT COUNT(*) INTO n FROM public.courses WHERE upper(course_code) = 'MTH101C';
  IF n < 20 THEN
    problems := problems || array['MTH101C under-seeded: ' || n || ' rows (science departments need it)'];
  END IF;
  SELECT COUNT(*) INTO n FROM public.courses WHERE upper(course_code) = 'PHY101C';
  IF n < 20 THEN
    problems := problems || array['PHY101C under-seeded: ' || n || ' rows (applicable science departments need it)'];
  END IF;

  -- Semesters: only First Semester / Second Semester (or empty)
  SELECT COUNT(DISTINCT semester) INTO n FROM public.courses
   WHERE semester IS NOT NULL AND semester <> ''
     AND semester NOT IN ('First Semester', 'Second Semester');
  IF n > 0 THEN
    problems := problems || array['invalid semester values found (must be First Semester / Second Semester)'];
  END IF;

  -- Maintenance setting row
  SELECT COUNT(*) INTO n FROM public.system_settings WHERE key = 'maintenance';
  IF n <> 1 THEN
    problems := problems || array['system_settings maintenance row missing'];
  END IF;

  -- Every auth account has a profile
  SELECT COUNT(*) INTO n
    FROM auth.users au
   WHERE au.email IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id);
  IF n > 0 THEN
    problems := problems || array[n || ' auth account(s) still without a profile'];
  END IF;

  IF array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION 'SCRIPT3 FAILED - % problem(s): %',
      array_length(problems, 1), array_to_string(problems, ' | ');
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '==================== SEED COMPLETE ===========================';
  RAISE NOTICE 'FUW E-Library reference data loaded successfully.';
  RAISE NOTICE 'Seeds : % faculties / % departments / % levels / % courses',
    (SELECT COUNT(*) FROM public.faculties),
    (SELECT COUNT(*) FROM public.departments),
    (SELECT COUNT(*) FROM public.levels),
    (SELECT COUNT(*) FROM public.courses);
  RAISE NOTICE 'Levels: 100-600 only. Semesters: First Semester / Second Semester.';
  RAISE NOTICE 'Material types: Test Questions / Exam Past Questions / Projects / Handouts.';
  RAISE NOTICE '==============================================================';
  RAISE NOTICE 'Bootstrap the owner once (after registering at /register):';
  RAISE NOTICE '  select public.promote_first_super_admin(''your-owner-email@example.com'');';
END $$;
