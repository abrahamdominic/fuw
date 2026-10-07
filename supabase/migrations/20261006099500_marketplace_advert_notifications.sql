-- =============================================================================
-- A notification type for the advert lifecycle.
--
-- This is its own migration on purpose. PostgreSQL refuses to let a transaction
-- use a value it just added to an enum ("unsafe use of new value of enum type"),
-- because the value cannot be sorted into place until the transaction commits.
-- The advert migration therefore has to run after this one.
-- =============================================================================

BEGIN;

ALTER TYPE public.marketplace_notification_type ADD VALUE IF NOT EXISTS 'advert_update';

COMMIT;