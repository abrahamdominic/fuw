-- =============================================================================
-- Marketplace: add the 'wallet' value to the payment provider enum
-- =============================================================================
-- WHY THIS IS ITS OWN FILE
-- -----------------------
-- PostgreSQL refuses to let a new enum value be *used* until the transaction
-- that added it has committed ("unsafe use of new value of enum type"). The
-- ledger migration below writes 'wallet'::marketplace_payment_provider, so the
-- ADD VALUE has to commit in a statement of its own before that file runs.
--
-- This is deliberately a single statement with no surrounding BEGIN: it commits
-- immediately, and every later statement sees the value as usable.
--
-- marketplace_payment_channel already carries 'wallet' (live), so nothing is
-- added there. IF NOT EXISTS keeps this file re-runnable.
-- =============================================================================

ALTER TYPE public.marketplace_payment_provider ADD VALUE IF NOT EXISTS 'wallet';