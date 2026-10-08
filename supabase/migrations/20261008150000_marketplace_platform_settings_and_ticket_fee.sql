-- =============================================================================
-- Migration: Add Event Ticket Fee and Admin Update RPC for Marketplace Settings
-- =============================================================================

BEGIN;

-- 1. Add event_ticket_fee_kobo to marketplace_platform_settings
ALTER TABLE public.marketplace_platform_settings
  ADD COLUMN IF NOT EXISTS event_ticket_fee_kobo integer NOT NULL DEFAULT 10000;

-- Ensure default value on existing record
UPDATE public.marketplace_platform_settings
SET event_ticket_fee_kobo = 10000
WHERE id = 1 AND (event_ticket_fee_kobo IS NULL OR event_ticket_fee_kobo = 0);

-- 2. Create mp_update_platform_settings RPC
CREATE OR REPLACE FUNCTION public.mp_update_platform_settings(
  p_default_commission_bps integer DEFAULT NULL,
  p_event_ticket_fee_kobo integer DEFAULT NULL,
  p_min_withdrawal_kobo integer DEFAULT NULL,
  p_settlement_delay_hours integer DEFAULT NULL,
  p_auto_confirm_hours integer DEFAULT NULL,
  p_return_window_hours integer DEFAULT NULL,
  p_require_vendor_verification boolean DEFAULT NULL,
  p_allow_registration boolean DEFAULT NULL,
  p_allow_new_vendors boolean DEFAULT NULL,
  p_payments_enabled boolean DEFAULT NULL,
  p_maintenance_mode boolean DEFAULT NULL
)
RETURNS public.marketplace_platform_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated public.marketplace_platform_settings;
BEGIN
  -- Authorization check: must be platform admin or super_admin
  IF NOT (public.is_admin()) THEN
    RAISE EXCEPTION 'Only administrators can modify marketplace platform settings.' USING ERRCODE = '42501';
  END IF;

  -- Validate ranges
  IF p_default_commission_bps IS NOT NULL AND (p_default_commission_bps < 0 OR p_default_commission_bps > 5000) THEN
    RAISE EXCEPTION 'Default commission must be between 0 and 5000 bps (0%% - 50%%).' USING ERRCODE = '22023';
  END IF;

  IF p_event_ticket_fee_kobo IS NOT NULL AND p_event_ticket_fee_kobo < 0 THEN
    RAISE EXCEPTION 'Event ticket fee cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF p_min_withdrawal_kobo IS NOT NULL AND p_min_withdrawal_kobo < 0 THEN
    RAISE EXCEPTION 'Minimum withdrawal cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF p_settlement_delay_hours IS NOT NULL AND (p_settlement_delay_hours < 0 OR p_settlement_delay_hours > 720) THEN
    RAISE EXCEPTION 'Settlement delay hours must be between 0 and 720 hours.' USING ERRCODE = '22023';
  END IF;

  IF p_auto_confirm_hours IS NOT NULL AND (p_auto_confirm_hours < 1 OR p_auto_confirm_hours > 720) THEN
    RAISE EXCEPTION 'Auto-confirm hours must be between 1 and 720 hours.' USING ERRCODE = '22023';
  END IF;

  IF p_return_window_hours IS NOT NULL AND (p_return_window_hours < 0 OR p_return_window_hours > 720) THEN
    RAISE EXCEPTION 'Return window hours must be between 0 and 720 hours.' USING ERRCODE = '22023';
  END IF;

  -- Update row 1
  UPDATE public.marketplace_platform_settings
  SET
    default_commission_bps = COALESCE(p_default_commission_bps, default_commission_bps),
    event_ticket_fee_kobo = COALESCE(p_event_ticket_fee_kobo, event_ticket_fee_kobo),
    min_withdrawal_kobo = COALESCE(p_min_withdrawal_kobo, min_withdrawal_kobo),
    settlement_delay_hours = COALESCE(p_settlement_delay_hours, settlement_delay_hours),
    auto_confirm_hours = COALESCE(p_auto_confirm_hours, auto_confirm_hours),
    return_window_hours = COALESCE(p_return_window_hours, return_window_hours),
    require_vendor_verification = COALESCE(p_require_vendor_verification, require_vendor_verification),
    allow_registration = COALESCE(p_allow_registration, allow_registration),
    allow_new_vendors = COALESCE(p_allow_new_vendors, allow_new_vendors),
    payments_enabled = COALESCE(p_payments_enabled, payments_enabled),
    maintenance_mode = COALESCE(p_maintenance_mode, maintenance_mode),
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = 1
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.mp_update_platform_settings(integer, integer, integer, integer, integer, integer, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mp_update_platform_settings(integer, integer, integer, integer, integer, integer, boolean, boolean, boolean, boolean, boolean) TO authenticated;

COMMIT;
