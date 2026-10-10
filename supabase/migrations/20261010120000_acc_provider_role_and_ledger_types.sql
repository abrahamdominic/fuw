-- =============================================================================
-- FUW Accommodation: Landlord / Caretaker roles + advert escrow ledger types
-- =============================================================================
-- PostgreSQL cannot use a new enum label in the same transaction that adds it.
-- This migration only adds labels and commits, so the later schema and RPC
-- migrations can reference them. Same pattern as
-- 20261006130000_wallet_ledger_entry_types.sql and
-- 20261009135000_marketplace_escrow_fee_entry_types.sql.

-- Two new, non-privileged account roles. They grant no administrative power:
-- every sensitive operation is still gated by is_platform_admin() or ownership.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'landlord';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'caretaker';

-- The accommodation advert fee is held (pending bucket, unavailable for
-- spending) while a listing waits for moderation, captured when an
-- administrator approves it, and released back to the available bucket when it
-- is rejected. These labels name the two legs of the reservation and release
-- moves.
ALTER TYPE public.marketplace_ledger_entry_type ADD VALUE IF NOT EXISTS 'advert_hold';
ALTER TYPE public.marketplace_ledger_entry_type ADD VALUE IF NOT EXISTS 'advert_hold_release';
