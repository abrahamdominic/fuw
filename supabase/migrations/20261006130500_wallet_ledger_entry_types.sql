-- =============================================================================
-- FUW Wallet: Add ledger entry types for wallet funding & eLibrary purchases
-- =============================================================================
-- Must be committed before statements that use these enum values.

ALTER TYPE public.marketplace_ledger_entry_type ADD VALUE IF NOT EXISTS 'wallet_funding';
ALTER TYPE public.marketplace_ledger_entry_type ADD VALUE IF NOT EXISTS 'elibrary_premium_purchase';
ALTER TYPE public.marketplace_ledger_entry_type ADD VALUE IF NOT EXISTS 'refund';
