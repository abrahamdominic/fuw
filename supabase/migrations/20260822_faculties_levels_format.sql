-- =====================================================================
-- 20260822 — Faculty restructure + level format normalization
-- 1. Rename faculties to the approved FUW structure:
--      Faculty of Life Sciences                    -> Faculty of Bio-Sciences
--      Faculty of Computing and Information Sciences -> Faculty of Computing & Information System
--    The College of Health Sciences becomes a parent category of four
--    faculties; department rows keep their (unchanged) department names,
--    but their faculty column is remapped to the correct member faculty.
-- 2. Normalize legacy level values ("1000 Level" / "10000 Level") to the
--    university format ("100 Level" … "600 Level").
-- Idempotent: safe to run multiple times.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Faculty renames (materials + profiles)
-- ---------------------------------------------------------------------
UPDATE public.materials
SET faculty = 'Faculty of Bio-Sciences'
WHERE faculty = 'Faculty of Life Sciences';

UPDATE public.profiles
SET faculty = 'Faculty of Bio-Sciences'
WHERE faculty = 'Faculty of Life Sciences';

UPDATE public.materials
SET faculty = 'Faculty of Computing & Information System'
WHERE faculty IN ('Faculty of Computing and Information Sciences', 'Faculty of Computing &amp; Information System');

UPDATE public.profiles
SET faculty = 'Faculty of Computing & Information System'
WHERE faculty IN ('Faculty of Computing and Information Sciences', 'Faculty of Computing &amp; Information System');

-- ---------------------------------------------------------------------
-- 2. College of Health Sciences: remap flat college rows to their
--    member faculties.
-- ---------------------------------------------------------------------
UPDATE public.materials m
SET faculty = CASE d.name
    WHEN 'Human Anatomy' THEN 'Faculty of Basic Medical Sciences'
    WHEN 'Human Physiology' THEN 'Faculty of Basic Medical Sciences'
    WHEN 'Medical Laboratory Science' THEN 'Faculty of Allied Health Sciences'
    WHEN 'Physiotherapy' THEN 'Faculty of Allied Health Sciences'
    WHEN 'Medicine' THEN 'Faculty of Clinical Sciences'
    WHEN 'Surgery' THEN 'Faculty of Clinical Sciences'
    WHEN 'Community Medicine' THEN 'Faculty of Clinical Sciences'
    WHEN 'Family Medicine' THEN 'Faculty of Clinical Sciences'
    WHEN 'Paediatrics' THEN 'Faculty of Clinical Sciences'
    ELSE 'Faculty of Basic Clinical Sciences'
  END
FROM (VALUES
  ('Human Anatomy'), ('Human Physiology'),
  ('Medical Laboratory Science'), ('Physiotherapy'),
  ('Medicine'), ('Surgery'), ('Community Medicine'), ('Family Medicine'), ('Paediatrics'),
  ('Medical Biochemistry'), ('Chemical Pathology'), ('Histopathology'),
  ('Haematology'), ('Pharmacology/Therapeutics')
) AS d(name)
WHERE m.faculty = 'College of Health Sciences' AND m.department = d.name;

UPDATE public.profiles p
SET faculty = CASE p.department
    WHEN 'Human Anatomy' THEN 'Faculty of Basic Medical Sciences'
    WHEN 'Human Physiology' THEN 'Faculty of Basic Medical Sciences'
    WHEN 'Medical Laboratory Science' THEN 'Faculty of Allied Health Sciences'
    WHEN 'Physiotherapy' THEN 'Faculty of Allied Health Sciences'
    WHEN 'Medicine' THEN 'Faculty of Clinical Sciences'
    WHEN 'Surgery' THEN 'Faculty of Clinical Sciences'
    WHEN 'Community Medicine' THEN 'Faculty of Clinical Sciences'
    WHEN 'Family Medicine' THEN 'Faculty of Clinical Sciences'
    WHEN 'Paediatrics' THEN 'Faculty of Clinical Sciences'
    ELSE 'Faculty of Basic Clinical Sciences'
  END
WHERE p.faculty = 'College of Health Sciences';

-- ---------------------------------------------------------------------
-- 3. Level format: collapse "1000/10000 Level" style values to
--    "100 … 600 Level". First digit is preserved, remaining digits are
--    discarded.
-- ---------------------------------------------------------------------
UPDATE public.materials
SET level = regexp_replace(level, '^([1-6])[0-9]*00\s*Level\s*$', '\100 Level')
WHERE level ~ '^([1-6])[0-9]*00\s*Level\s*$'
  AND level <> regexp_replace(level, '^([1-6])[0-9]*00\s*Level\s*$', '\100 Level');

UPDATE public.profiles
SET level = regexp_replace(level, '^([1-6])[0-9]*00\s*Level\s*$', '\100 Level')
WHERE level IS NOT NULL
  AND level ~ '^([1-6])[0-9]*00\s*Level\s*$'
  AND level <> regexp_replace(level, '^([1-6])[0-9]*00\s*Level\s*$', '\100 Level');
