-- Keep cbt_questions.course_title aligned with the course catalogue. The
-- generator's insert path ignores duplicate dedupe_keys, so rows created before
-- the title was sourced from the catalogue (notably CHM102C and PHY102C, which
-- were stored as "General Biology II") are corrected here instead.
BEGIN;

UPDATE public.cbt_questions AS q
   SET course_title = c.title,
       updated_at = now()
  FROM (VALUES
    ('BIO102C', 'General Biology II'),
    ('CHM102C', 'General Chemistry II'),
    ('PHY102C', 'General Physics II'),
    ('MTH102C', 'Elementary Mathematics II'),
    ('MCB102F', 'Introductory Microbiology')
  ) AS c(code, title)
 WHERE q.course_code = c.code
   AND q.course_title IS DISTINCT FROM c.title;

COMMIT;
