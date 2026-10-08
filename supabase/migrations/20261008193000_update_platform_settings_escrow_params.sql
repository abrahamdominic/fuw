-- Drop previous overloaded signatures
DROP FUNCTION IF EXISTS public.mp_update_platform_settings(
  integer, integer, integer, integer, integer, integer, boolean, boolean, boolean, boolean, boolean
) CASCADE;

DROP FUNCTION IF EXISTS public.mp_update_platform_settings(
  integer, integer, integer, integer, integer, integer, boolean, boolean, boolean, boolean, boolean,
  bigint, bigint, integer, boolean, boolean, boolean
) CASCADE;

-- Create updated mp_update_platform_settings RPC
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
  p_maintenance_mode boolean DEFAULT NULL,
  p_escrow_fee_kobo bigint DEFAULT NULL,
  p_premium_escrow_credit_kobo bigint DEFAULT NULL,
  p_premium_escrow_discount_pct integer DEFAULT NULL,
  p_premium_marketplace_benefits_enabled boolean DEFAULT NULL,
  p_verified_scholar_badge_enabled boolean DEFAULT NULL,
  p_premium_visibility_enabled boolean DEFAULT NULL
)
RETURNS public.marketplace_platform_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated public.marketplace_platform_settings;
BEGIN
  IF NOT (public.is_admin()) THEN
    RAISE EXCEPTION 'Only administrators can modify marketplace platform settings.' USING ERRCODE = '42501';
  END IF;

  IF p_default_commission_bps IS NOT NULL AND (p_default_commission_bps < 0 OR p_default_commission_bps > 5000) THEN
    RAISE EXCEPTION 'Default commission must be between 0 and 5000 bps (0%% - 50%%).' USING ERRCODE = '22023';
  END IF;

  IF p_event_ticket_fee_kobo IS NOT NULL AND p_event_ticket_fee_kobo < 0 THEN
    RAISE EXCEPTION 'Event ticket fee cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF p_min_withdrawal_kobo IS NOT NULL AND p_min_withdrawal_kobo < 0 THEN
    RAISE EXCEPTION 'Minimum withdrawal cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF p_escrow_fee_kobo IS NOT NULL AND p_escrow_fee_kobo < 0 THEN
    RAISE EXCEPTION 'Escrow fee cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF p_premium_escrow_credit_kobo IS NOT NULL AND p_premium_escrow_credit_kobo < 0 THEN
    RAISE EXCEPTION 'Premium escrow credit cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF p_premium_escrow_discount_pct IS NOT NULL AND (p_premium_escrow_discount_pct < 0 OR p_premium_escrow_discount_pct > 100) THEN
    RAISE EXCEPTION 'Discount percentage must be between 0 and 100.' USING ERRCODE = '22023';
  END IF;

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
    escrow_fee_kobo = COALESCE(p_escrow_fee_kobo, escrow_fee_kobo),
    premium_escrow_credit_kobo = COALESCE(p_premium_escrow_credit_kobo, premium_escrow_credit_kobo),
    premium_escrow_discount_pct = COALESCE(p_premium_escrow_discount_pct, premium_escrow_discount_pct),
    premium_marketplace_benefits_enabled = COALESCE(p_premium_marketplace_benefits_enabled, premium_marketplace_benefits_enabled),
    verified_scholar_badge_enabled = COALESCE(p_verified_scholar_badge_enabled, verified_scholar_badge_enabled),
    premium_visibility_enabled = COALESCE(p_premium_visibility_enabled, premium_visibility_enabled),
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = 1
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mp_update_platform_settings TO authenticated, service_role;
