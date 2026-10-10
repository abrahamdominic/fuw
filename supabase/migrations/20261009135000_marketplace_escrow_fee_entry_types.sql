-- =============================================================================
-- FUW Marketplace: Add ledger entry types for the escrow fee
-- =============================================================================
-- The buyer-paid escrow fee is held (pending, non-withdrawable) when the escrow
-- is funded, recognised (pending -> available) when the settlement for the order
-- matures, and unwound when the order is refunded or cancelled.
--
-- PostgreSQL cannot use an enum label in the same transaction that adds it, so
-- the labels live in their own migration that commits before the pricing
-- migration that references them (same pattern as
-- 20261006130000_wallet_ledger_entry_types.sql).

ALTER TYPE public.marketplace_ledger_entry_type ADD VALUE IF NOT EXISTS 'escrow_fee';
ALTER TYPE public.marketplace_ledger_entry_type ADD VALUE IF NOT EXISTS 'escrow_fee_recognised';
ALTER TYPE public.marketplace_ledger_entry_type ADD VALUE IF NOT EXISTS 'escrow_fee_refund';
