-- =============================================================================
-- PHASE 16: vendor ↔ admin support threads.
--
-- The kind value lives in its own migration on purpose. PostgreSQL will not
-- let one transaction both add a value to an enum and use that value, because
-- the value cannot be sorted into place until the transaction commits.
-- =============================================================================

ALTER TYPE public.marketplace_conversation_kind ADD VALUE IF NOT EXISTS 'support';