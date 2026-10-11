-- =============================================================================
-- Part 3: Referral system fixes
--
-- Root causes addressed:
--   1. A user could be "referred" more than once (no unique on referred_user_id),
--      and apply_referral_code() returned success even when the INSERT did nothing
--      (no-op recorded as a win). -> one referral per user + honest outcomes.
--   2. The milestone awarded has_plus_lifetime, a flag no premium gate reads, so a
--      Course Rep reaching the milestone got zero actual access.
--   3. Wrong milestone copy (5 referrals -> "permanent lifetime") and a wrong plan
--      slug default ('semester-access' did not exist).
-- New contract: 10 converted referrals unlock ONE SEMESTER of Campus Hub Plus
-- (plus_semester plan, 120 days), granted once, server-side, deduplicated.
-- =============================================================================

-- A student can only ever be referred by one ambassador.
CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_referrals_one_referred
  ON public.affiliate_referrals (referred_user_id);

-- -----------------------------------------------------------------------------
-- 1. Honest apply_referral_code
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_profile      public.profiles%ROWTYPE;
  v_referrer     public.profiles%ROWTYPE;
  v_code         TEXT := upper(trim(COALESCE(p_code, '')));
  v_clean        TEXT;
  v_inserted     BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '28000';
  END IF;

  IF v_code = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Enter a referral code');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Already attached to an ambassador? Idempotent success, not a new record.
  IF v_profile.referred_by_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.affiliate_referrals r WHERE r.referred_user_id = v_uid) THEN
    RETURN jsonb_build_object(
      'success', true, 'already', true, 'referral_code', v_code,
      'referrer_name', COALESCE((SELECT full_name FROM public.profiles WHERE id = v_profile.referred_by_id), 'Campus Hub Ambassador')
    );
  END IF;

  v_clean := lower(regexp_replace(v_code, '[^A-Za-z0-9-]', '', 'g'));
  SELECT * INTO v_referrer
    FROM public.profiles
   WHERE lower(referral_code) = v_clean
     AND id <> v_uid
     AND is_active = TRUE
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid referral code');
  END IF;

  UPDATE public.profiles
     SET referred_by_id = v_referrer.id,
         updated_at = now()
   WHERE id = v_uid;

  -- One row per referred user. In any race the unique constraints decide:
  -- per (referrer, referred) pair and per unique referred_user_id.
  BEGIN
    INSERT INTO public.affiliate_referrals (
      referrer_id, referred_user_id, referral_code, referral_type, status
    ) VALUES (
      v_referrer.id, v_uid, v_code, 'student', 'registered'
    )
    RETURNING (referrer_id IS NOT NULL) INTO v_inserted;
  EXCEPTION WHEN unique_violation THEN
    v_inserted := false;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'already', false,
    'referrer_name', COALESCE(v_referrer.full_name, 'Campus Hub Ambassador'),
    'referral_code', v_code,
    'inserted', COALESCE(v_inserted, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_referral_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Reward ledger: one-semester premium milestone
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliate_rewards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reward_type     TEXT NOT NULL DEFAULT 'one_semester_premium'
                    CHECK (reward_type IN ('one_semester_premium')),
  plan_id         UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A reward type can only ever be granted once per ambassador.
CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_rewards_one_per_referrer
  ON public.affiliate_rewards (referrer_id, reward_type);

ALTER TABLE public.affiliate_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "affiliate_rewards read own" ON public.affiliate_rewards;
CREATE POLICY "affiliate_rewards read own" ON public.affiliate_rewards
  FOR SELECT TO authenticated
  USING (referrer_id = auth.uid() OR public.is_admin());

REVOKE ALL ON public.affiliate_rewards FROM anon;
GRANT SELECT ON public.affiliate_rewards TO authenticated;

COMMENT ON TABLE public.affiliate_rewards IS
  'Referral milestone rewards. Granting is server-side only (grant_referral_milestone)
  and deduplicated by (referrer_id, reward_type).';

-- Server-side, idempotent milestone grant. Called by the commission trigger and
-- grantable by nobody else (EXECUTE is not granted to any role).
CREATE OR REPLACE FUNCTION public.grant_referral_milestone(
  p_referrer_id UUID,
  p_plan_slug   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_threshold CONSTANT INTEGER := 10;
  v_conv       INTEGER;
  v_plan       public.plans%ROWTYPE;
  v_sub        public.subscriptions%ROWTYPE;
  v_reward     public.affiliate_rewards%ROWTYPE;
  v_gifter     text;
  v_ref        text;
BEGIN
  IF p_referrer_id IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'missing_referrer');
  END IF;

  -- Serialise per referrer: a race cannot double-grant.
  SELECT gifter.full_name INTO v_gifter
    FROM public.profiles WHERE id = p_referrer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_profile');
  END IF;

  -- Already rewarded? Never grant a second time.
  SELECT * INTO v_reward FROM public.affiliate_rewards
    WHERE referrer_id = p_referrer_id AND reward_type = 'one_semester_premium';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'granted', false, 'already', true,
      'reward_type', v_reward.reward_type,
      'subscription_id', v_reward.subscription_id
    );
  END IF;

  SELECT count(*) INTO v_conv
    FROM public.affiliate_referrals
   WHERE referrer_id = p_referrer_id AND status = 'converted'
     FOR SHARE;
  IF v_conv < v_threshold THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'below_threshold',
      'converted_referrals', v_conv, 'threshold', v_threshold);
  END IF;

  -- Pick the semester plan: the requested one, else the cheapest semester-like
  -- premium plan, else any active premium plan.
  SELECT * INTO v_plan
    FROM public.plans
   WHERE slug = lower(btrim(COALESCE(p_plan_slug, '')))
     AND is_active AND is_premium;
  IF NOT FOUND THEN
    SELECT * INTO v_plan
      FROM public.plans
     WHERE is_active AND is_premium
       AND (slug LIKE '%semester%' OR name ILIKE '%semester%')
     ORDER BY duration_days ASC, price_kobo ASC
     LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    SELECT * INTO v_plan
      FROM public.plans
     WHERE is_active AND is_premium
     ORDER BY duration_days ASC, price_kobo ASC
     LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_plan');
  END IF;

  -- Grant one semester of Campus Hub Plus. The admin_note sentinel keeps this
  -- subscription out of the affiliate-commission trigger (no commission on a
  -- reward) while the regular premium triggers (escrow credit, entitlements)
  -- still fire, so the reward actually unlocks access.
  INSERT INTO public.subscriptions (
    user_id, plan_id, status, starts_at, expires_at, admin_note
  ) VALUES (
    p_referrer_id, v_plan.id, 'active', now(),
    now() + make_interval(days => v_plan.duration_days),
    'Milestone reward: ' || v_conv || ' converted referrals'
  ) RETURNING * INTO v_sub;

  INSERT INTO public.affiliate_rewards (
    referrer_id, reward_type, plan_id, subscription_id, granted_at, created_by
  ) VALUES (
    p_referrer_id, 'one_semester_premium', v_plan.id, v_sub.id, now(), p_referrer_id
  )
  ON CONFLICT ON CONSTRAINT idx_affiliate_rewards_one_per_referrer DO NOTHING;

  INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
  VALUES (
    p_referrer_id,
    'Milestone Reached: One Semester of Campus Hub Plus!',
    format('Congratulations! You referred %s students who upgraded. You unlocked One Semester of Campus Hub Plus (%s) as a reward.', v_conv, v_plan.name),
    'system',
    '/student/profile',
    'milestone_semester_reward:' || p_referrer_id
  );

  PERFORM public.mp_audit('referral.milestone_granted', 'affiliate_rewards', v_reward.id,
    NULL, jsonb_build_object('referrer_id', p_referrer_id, 'plan_slug', v_plan.slug,
      'subscription_id', v_sub.id, 'converted', v_conv),
    'One-semester premium milestone reward granted', 'auto');

  RETURN jsonb_build_object(
    'granted', true,
    'plan_slug', v_plan.slug,
    'plan_name', v_plan.name,
    'duration_days', v_plan.duration_days,
    'subscription_id', v_sub.id,
    'expires_at', v_sub.expires_at,
    'converted_referrals', v_conv,
    'threshold', v_threshold
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_referral_milestone(UUID, TEXT) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3. Commission trigger: real conversions, ten-referral milestone, no no-ops
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_affiliate_subscription_commission ON public.subscriptions;
CREATE OR REPLACE FUNCTION public.trg_process_affiliate_subscription_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student public.profiles%ROWTYPE;
  v_referrer public.profiles%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_comm_kobo BIGINT;
  v_wallet UUID;
  v_entry UUID;
  v_conv_count INTEGER;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- Milestone rewards granted to the Course Rep themselves are not purchases and
  -- must not generate a commission for anyone.
  IF NEW.admin_note LIKE 'Milestone reward:%' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_student FROM public.profiles WHERE id = NEW.user_id;
  IF NOT FOUND OR v_student.referred_by_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_referrer FROM public.profiles WHERE id = v_student.referred_by_id;
  IF NOT FOUND OR NOT v_referrer.is_active OR v_student.id = v_referrer.id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = NEW.plan_id;
  IF NOT FOUND OR v_plan.price_kobo <= 0 THEN
    RETURN NEW;
  END IF;

  v_comm_kobo := (v_plan.price_kobo * 0.10)::BIGINT;
  IF v_comm_kobo <= 0 THEN
    RETURN NEW;
  END IF;

  v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_referrer.id);
  v_entry := public.mp_wallet_post(
    p_wallet_id => v_wallet,
    p_direction => 'credit'::public.marketplace_ledger_direction,
    p_bucket => 'available'::public.marketplace_wallet_bucket,
    p_amount_kobo => v_comm_kobo,
    p_entry_type => 'affiliate_commission'::public.marketplace_ledger_entry_type,
    p_reference_type => 'subscription',
    p_reference_id => NEW.id,
    p_idempotency_key => 'affiliate_comm:' || NEW.id::TEXT || ':' || v_referrer.id::TEXT,
    p_description => format('10%% Affiliate Commission for student %s Premium subscription', COALESCE(v_student.matric_number, v_student.full_name, 'student')),
    p_metadata => jsonb_build_object(
      'referred_student_id', v_student.id,
      'plan_price_kobo', v_plan.price_kobo,
      'subscription_id', NEW.id
    ),
    p_actor_id => v_student.id
  );

  INSERT INTO public.affiliate_commissions (
    referrer_id, referred_user_id, amount_kobo, commission_rate,
    source_type, status, wallet_entry_id
  ) VALUES (
    v_referrer.id, v_student.id, v_comm_kobo, 0.10,
    'premium_subscription', 'credited', v_entry
  );

  UPDATE public.affiliate_referrals
     SET status = 'converted'
   WHERE referrer_id = v_referrer.id AND referred_user_id = v_student.id;

  -- Milestone: 10 converted referrals unlock one semester of Campus Hub Plus.
  -- grant_referral_milestone() is idempotent, so the race/rerun is safe.
  SELECT count(*) INTO v_conv_count
    FROM public.affiliate_referrals
   WHERE referrer_id = v_referrer.id AND status = 'converted';

  IF v_conv_count >= 10 THEN
    PERFORM public.grant_referral_milestone(v_referrer.id, 'plus_semester');
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, dedupe_key)
  VALUES (
    v_referrer.id,
    'Affiliate Commission Earned!',
    format('You just earned ₦%s (10%% commission) from a student Premium subscription!', (v_comm_kobo / 100)::TEXT),
    'system',
    'aff_comm:' || NEW.id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_affiliate_subscription_commission
  AFTER INSERT ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_process_affiliate_subscription_commission();

-- -----------------------------------------------------------------------------
-- 4. Dashboard stats: milestone progress + reward state (plus retrofit)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_affiliate_dashboard_stats(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_total_refs INTEGER;
  v_conv_refs INTEGER;
  v_total_earned_kobo BIGINT;
  v_wallet UUID;
  v_wallet_bal BIGINT := 0;
  v_reward public.affiliate_rewards%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_milestone_granted BOOLEAN := false;
  v_milestone_expires TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_total_refs FROM public.affiliate_referrals WHERE referrer_id = p_user_id;
  SELECT count(*) INTO v_conv_refs FROM public.affiliate_referrals WHERE referrer_id = p_user_id AND status = 'converted';
  SELECT COALESCE(sum(amount_kobo), 0) INTO v_total_earned_kobo FROM public.affiliate_commissions WHERE referrer_id = p_user_id;

  SELECT * INTO v_reward FROM public.affiliate_rewards
   WHERE referrer_id = p_user_id AND reward_type = 'one_semester_premium';
  IF FOUND THEN
    v_milestone_granted := true;
    SELECT * INTO v_sub FROM public.subscriptions WHERE id = v_reward.subscription_id;
    IF FOUND THEN
      v_milestone_expires := v_sub.expires_at;
    ELSE
      v_milestone_expires := v_reward.granted_at + make_interval(days => 120);
    END IF;
  END IF;

  v_wallet := public.mp_wallet_ensure(p_owner_user_id => p_user_id);
  SELECT COALESCE(available_kobo, 0) INTO v_wallet_bal FROM public.marketplace_wallets WHERE id = v_wallet;

  RETURN jsonb_build_object(
    'is_course_rep', v_profile.is_course_rep,
    'course_rep_level', v_profile.course_rep_level,
    'referral_code', COALESCE(v_profile.referral_code, public.generate_user_referral_code(p_user_id)),
    'total_referrals', v_total_refs,
    'converted_referrals', v_conv_refs,
    'total_earned_kobo', v_total_earned_kobo,
    'available_wallet_kobo', v_wallet_bal,
    'has_plus_lifetime', v_profile.has_plus_lifetime,
    'commission_rate_percent', 10,
    'milestone_target_converted', 10,
    'milestone_remaining', GREATEST(0, 10 - v_conv_refs),
    'milestone_reward_type', 'one_semester_premium',
    'milestone_reward_granted', v_milestone_granted,
    'milestone_reward_expires_at', v_milestone_expires
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_affiliate_dashboard_stats(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Fix the gifting default plan slug ('semester-access' never existed)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gift_premium_plan_from_wallet(
  p_recipient_identifier TEXT,
  p_plan_slug TEXT DEFAULT 'plus_semester'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gifter_uid UUID := auth.uid();
  v_recipient public.profiles%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_wallet UUID;
  v_wallet_row public.marketplace_wallets%ROWTYPE;
  v_entry UUID;
  v_ref TEXT;
  v_tx public.payment_transactions%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_config JSONB;
BEGIN
  IF v_gifter_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to send a Premium gift.' USING ERRCODE = '28000';
  END IF;

  IF NULLIF(trim(p_recipient_identifier), '') IS NULL THEN
    RAISE EXCEPTION 'Enter the recipient matriculation number or email.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_recipient
  FROM public.profiles
  WHERE (
    lower(trim(matric_number)) = lower(trim(p_recipient_identifier))
    OR lower(trim(email)) = lower(trim(p_recipient_identifier))
    OR lower(trim(display_name)) = lower(trim(p_recipient_identifier))
  )
  AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No student account was found matching "%". Please verify the matriculation number or email.', p_recipient_identifier
      USING ERRCODE = 'P0002';
  END IF;

  IF v_recipient.id = v_gifter_uid THEN
    RAISE EXCEPTION 'To subscribe for yourself, use the standard wallet subscription.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_plan FROM public.plans
  WHERE slug = lower(btrim(p_plan_slug)) AND is_active AND is_premium AND price_kobo > 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That Premium plan is unavailable.' USING ERRCODE = '22023';
  END IF;

  v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_gifter_uid);
  SELECT * INTO v_wallet_row FROM public.marketplace_wallets WHERE id = v_wallet FOR UPDATE;

  IF v_wallet_row.is_frozen THEN
    RAISE EXCEPTION 'Your wallet is frozen: %', COALESCE(v_wallet_row.frozen_reason, 'contact support')
      USING ERRCODE = '42501';
  END IF;

  IF v_wallet_row.available_kobo < v_plan.price_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance. You have ₦%, but ₦% is required.',
      (v_wallet_row.available_kobo / 100)::TEXT, (v_plan.price_kobo / 100)::TEXT
      USING ERRCODE = '23514';
  END IF;

  v_ref := 'FUW-GIFT-' || upper(replace(gen_random_uuid()::TEXT, '-', ''));

  v_entry := public.mp_wallet_post(
    p_wallet_id => v_wallet,
    p_direction => 'debit'::public.marketplace_ledger_direction,
    p_bucket => 'available'::public.marketplace_wallet_bucket,
    p_amount_kobo => v_plan.price_kobo,
    p_entry_type => 'gift_premium_purchase'::public.marketplace_ledger_entry_type,
    p_reference_type => 'plan',
    p_reference_id => v_plan.id,
    p_idempotency_key => 'gift:' || v_plan.id::TEXT || ':' || v_recipient.id::TEXT || ':' || extract(epoch FROM now())::BIGINT,
    p_description => format('Gift of %s to %s', v_plan.name, COALESCE(v_recipient.full_name, v_recipient.matric_number, 'student')),
    p_metadata => jsonb_build_object(
      'recipient_id', v_recipient.id,
      'recipient_matric', v_recipient.matric_number,
      'plan_id', v_plan.id,
      'reference', v_ref
    ),
    p_actor_id => v_gifter_uid
  );

  v_config := public.get_payment_configuration();

  INSERT INTO public.payment_transactions (
    user_id, payment_reference, plan_id, amount_kobo, currency,
    payment_method, provider, provider_transaction_id,
    status, verification_status, verified_at, metadata
  ) VALUES (
    v_gifter_uid, v_ref, v_plan.id, v_plan.price_kobo, COALESCE(v_config->>'currency', 'NGN'),
    'automatic', 'wallet_gift', v_entry::TEXT,
    'verified', 'verified', now(),
    jsonb_build_object('recipient_id', v_recipient.id, 'wallet_entry_id', v_entry)
  ) RETURNING * INTO v_tx;

  -- Activate recipient subscription (fires trigger to allocate escrow credit)
  INSERT INTO public.subscriptions (
    user_id, plan_id, status, starts_at, expires_at, admin_note
  ) VALUES (
    v_recipient.id, v_plan.id, 'active', now(),
    now() + make_interval(days => v_plan.duration_days),
    'Gift subscription from ' || (SELECT COALESCE(full_name, email) FROM public.profiles WHERE id = v_gifter_uid)
  ) RETURNING * INTO v_sub;

  INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
  VALUES (
    v_recipient.id,
    'You received a Premium Gift!',
    format('A student gifted you %s! You now have unlimited library downloads, campus hub plus access, and your Verified Scholar badge.', v_plan.name),
    'system',
    '/student/profile',
    'gift_received:' || v_sub.id
  );

  INSERT INTO public.notifications (user_id, title, message, type, dedupe_key)
  VALUES (
    v_gifter_uid,
    'Premium Gift Sent',
    format('You successfully gifted %s to %s.', v_plan.name, COALESCE(v_recipient.full_name, v_recipient.matric_number)),
    'system',
    'gift_sent:' || v_sub.id
  );

  RETURN jsonb_build_object(
    'success', true,
    'recipient_name', v_recipient.full_name,
    'recipient_matric', v_recipient.matric_number,
    'plan_name', v_plan.name,
    'amount_kobo', v_plan.price_kobo,
    'expires_at', v_sub.expires_at,
    'reference', v_ref
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gift_premium_plan_from_wallet(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_premium_plan_from_wallet(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.apply_referral_code(TEXT) IS
  'Records at most one referral per student. Returns already=true when the caller
  is already attached to an ambassador, and success=false only for genuinely
  invalid or impossible referrals.';
COMMENT ON FUNCTION public.grant_referral_milestone(UUID, TEXT) IS
  'Awards one semester of Campus Hub Plus to an ambassador with 10 converted
  referrals. Exactly-once per ambassador; never grants a fraction or a duplicate.';