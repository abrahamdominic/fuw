-- =============================================================================
-- PHASE 17: WALLET HARDENING
--
-- The wallet RPCs are all guarded by auth.uid() at runtime, and the smoke
-- harness confirms an anonymous session is refused by every one of them. But
-- `GRANT ... TO authenticated` leaves the PUBLIC default execute in place, so
-- `anon` still holds EXECUTE on mp_wallet_get, mp_wallet_statement and
-- mp_pay_order_from_wallet. That is defence in depth in the wrong direction: a
-- future refactor that weakens one of the auth.uid() checks would silently
-- expose a wallet read or a payment to logged-out callers.
--
-- This revokes the default execute on the buyer-facing wallet surface so the
-- role list is explicit, matching how the support messaging RPCs are granted.
-- mp_wallet_post and mp_wallet_ensure stay service_role only and are not
-- touched here; see 20261006091000.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.mp_wallet_get(UUID)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mp_wallet_get(UUID)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.mp_wallet_statement(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mp_wallet_statement(UUID, INTEGER, INTEGER)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.mp_pay_order_from_wallet(UUID)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mp_pay_order_from_wallet(UUID)
  TO authenticated, service_role;

-- The platform-wide totals view is aggregated money, not one student's ledger,
-- and VendorDashboardPage shows it to signed-in vendors, so it keeps PUBLIC
-- execute on purpose. anon cannot reach it through the API anyway, since every
-- wallet-facing RLS policy requires auth.uid().
