-- The Premium gift notification (inside gift_premium_plan_from_wallet) still
-- told recipients they receive ₦2,000 in Marketplace escrow credit. The credit
-- is now ₦500, so patch the installed function body in place. Patching via
-- pg_get_functiondef keeps the (large) body byte-identical apart from the
-- message and is idempotent: it is a no-op once the text is already updated.
BEGIN;

DO $migrate$
DECLARE
  v_oid oid := 'public.gift_premium_plan_from_wallet(text,text)'::regprocedure;
  v_def text;
BEGIN
  v_def := pg_get_functiondef(v_oid);
  IF position('₦2,000 marketplace escrow credit' IN v_def) = 0 THEN
    RAISE NOTICE 'gift notification already updated';
    RETURN;
  END IF;
  v_def := replace(
    v_def,
    '₦2,000 marketplace escrow credit',
    '₦500 marketplace escrow credit'
  );
  EXECUTE v_def;
END
$migrate$;

-- Re-assert the original surface (OR REPLACE preserves these, but keep the
-- grants explicit so the migration is self-describing and safe if re-run).
REVOKE ALL ON FUNCTION public.gift_premium_plan_from_wallet(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_premium_plan_from_wallet(TEXT, TEXT) TO authenticated;

COMMIT;
