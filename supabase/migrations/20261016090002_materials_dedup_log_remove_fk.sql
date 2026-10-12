-- Migration: 20261016090002_materials_dedup_log_remove_fk.sql
-- The audit trail must survive the removal of the material it records.
-- removed_material_id is kept as a plain UUID (the FK is dropped) so that
-- deleting a duplicate upload cannot cascade-delete its dedup log entry.
-- canonical_material_id keeps its FK (CASCADE) so housekeeping that removes
-- a canonical cleanly cleans its history too.

BEGIN;

ALTER TABLE public.materials_dedup_log
  DROP CONSTRAINT IF EXISTS materials_dedup_log_removed_material_id_fkey;

COMMIT;