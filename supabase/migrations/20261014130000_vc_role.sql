-- =============================================================================
-- VC role — enum addition only
--
-- The `vc` app_role is added in its own transaction because PostgreSQL forbids
-- using a freshly-added enum value within the same transaction that created it.
-- The functions, RPCs and RLS hardening that reference 'vc' live in
-- `20261014131000_vc_dashboard_and_security.sql`, which runs as a separate
-- migration after this one has committed.
--
-- The VC is provisioned exclusively by the Super Admin and can never self-
-- register (see provision_vice_chancellor() in the follow-up migration).
-- =============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'vc';