# FUW E-Library — Migration & Edge Function Deployment Runbook

This runbook applies the security follow-up migration and deploys the hardened
edge functions to Supabase. It is the operator-facing counterpart to the
`audit.md` security review.

> **Read first.** A critical key was leaked in Git history (SEC-01). Rotate the
> service_role key before proceeding if you have not already. See §5.

---

## 0. Before you start

- You need **dashboard access** to the FUW Supabase project (SQL Editor,
  Edge Functions, Project Settings).
- Supabase CLI v2 (≥ 2.116) is available in this repo via `npx supabase`.
- Take a **backup first** (see README §4): Dashboard → Project Settings →
  Database → Backups. Export CSVs of `profiles`, `materials`, `faculties`,
  `departments`, `courses` as a belt-and-braces copy.

---

## 1. Apply the security follow-up migration

The migration files to apply, in order, are:

```
supabase/migrations/20260831_security_followup.sql
supabase/migrations/20260901_storage_and_session_hardening.sql
```

Both are **transactional and idempotent** (safe to run repeatedly).

**`20260831_security_followup.sql`:**

1. `REVOKE ... FROM anon` on `count_students_by_gender()`,
   `count_materials_by_faculty()`, `count_materials_by_department()`,
   `register_identity_check(text,text)` — closes anonymous account/analytics
   enumeration (AUTH-01/AUTH-02, F1/F3).
2. Adds `WITH CHECK (auth.uid() = user_id)` to the `active_sessions` student
   "update own session" policy **and** an `active_sessions_student_update_guard()`
   trigger that forbids students from altering device/identity fields
   (`user_id`, `session_key`, `device_type`, `browser`, `os`, `ip_address`,
   `location`, `connection_type`, `network_name`, `user_agent`). Admins bypass.
3. Adds a `BEFORE UPDATE` trigger on the `library-materials` storage objects
   reusing `reject_invalid_library_upload()`.

**`20260901_storage_and_session_hardening.sql`** (found during the audit re-run):

4. **STOR-01 (High):** `reject_invalid_library_upload()` previously only
   validated on `INSERT`; its `BEFORE UPDATE` trigger fired but skipped the
   entire validation body (the code was gated behind `IF TG_OP = 'INSERT'`), so
   an approved object could be overwritten with scriptable bytes while keeping a
   document MIME. The function now validates on **both** INSERT and UPDATE and
   forbids moving books out of `library-materials`.
5. **AUTHZ-04 (Med):** `cleanup_stale_sessions()` was SECURITY DEFINER granted to
   all authenticated with **no user scoping** — any student could delete the
   whole site's idle sessions. It now permits admins to clean the whole table
   (needed by the admin "all sessions" view) but restricts non-admin callers to
   their **own** stale sessions.
6. **AUTHZ-05 (Low):** revoked `increment_download_count()` /
   `increment_view_count()` from `anon` (they are SECURITY DEFINER write
   functions; anonymous visitors can no longer inflate counts).

> **Scope note on "magic-byte" checks:** true file-signature sniffing cannot run
> in a `storage.objects` trigger because the bytes live in the external object
> store, not the table. Magic-byte verification is instead done client-side
> before upload (`src/lib/materials.ts` `sniffDocumentMagicBytes`), files are
> served with `nosniff` + strict CSP (`netlify.toml`), and the reader runs in a
> sandbox iframe (no `allow-scripts`). The trigger enforces the content-type
> allow/deny list at the DB level on every write.

### Steps

1. Open **Supabase Dashboard → SQL Editor → New query**.
2. Paste the entire contents of `20260831_security_followup.sql` → **Run**.
3. Paste the entire contents of `20260901_storage_and_session_hardening.sql` → **Run**.
4. Confirm each returns without error. Because both are idempotent, re-running
   is safe if you need to.

### Post-migration verification (SQL Editor)

```sql
-- 1. anon should have NO grants on the audit-sensitive RPCs
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN
      ('count_students_by_gender','count_materials_by_faculty',
       'count_materials_by_department','register_identity_check')
ORDER BY p.proname;
-- Expect: anon_can_execute = false for ALL rows.

-- 2. active_sessions "update own session" policy has WITH CHECK restricting user_id
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'active_sessions' AND cmd = 'UPDATE';
-- Expect with_check to reference auth.uid() = user_id.

-- 3. storage validation trigger present (INSERT + UPDATE)
SELECT trigger_name, event_manipulation
FROM information_schema.triggers
WHERE event_object_schema = 'storage'
  AND event_object_table = 'objects'
  AND trigger_name LIKE 'trg_reject_invalid_library_upload%';
-- Expect BOTH a BEFORE INSERT and a BEFORE UPDATE row.

-- 4. cleanup_stale_sessions is user-scoped for non-admins
SELECT prosrc FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'cleanup_stale_sessions';
-- Expect prosrc to branch on is_admin() with DELETE ... user_id = auth.uid()
-- in the non-admin path (no unscoped mass deletion by students).

-- 5. anon can no longer EXECUTE the increment functions
SELECT has_function_privilege('anon',
  'public.increment_download_count(uuid)', 'EXECUTE') AS anon_dl,
       has_function_privilege('anon',
  'public.increment_view_count(uuid)', 'EXECUTE') AS anon_view;
-- Expect both false. authenticated should still be true.
```

---

## 2. Set required environment variables

These are **function secrets** (set per-function in the dashboard and/or CLI),
**not** committed anywhere.

| Variable          | Purpose                                                                                          | Required |
| ----------------- | ------------------------------------------------------------------------------------------------ | -------- |
| `APP_ORIGIN`      | Comma-separated trusted origins, e.g. `https://fuw-e-library.netlify.app`. Drives CORS allow-list and the password-reset redirect allow-list. | **Yes** before deploying `resolve-login`/AI functions |
| `AI_API_KEY`      | Server-side AI provider key (OpenAI-compatible). Emitted for `ai-chat`/`ai-search`/`ai-process`.  | Yes (for AI) |
| `AI_BASE_URL`     | Optional; defaults to `https://api.openai.com/v1`.                                                | No        |
| `AI_MODEL`        | Optional; defaults to `gpt-4o-mini`.                                                              | No        |
| `EMBEDDING_MODEL` | Optional; defaults to `text-embedding-3-small`.                                                   | No        |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically by the platform; you do not set them.

> **Important (CORS / open-redirect):** if `APP_ORIGIN` is empty or unset:
> - AI edge functions omit CORS headers for unknown origins → cross-origin
>   browser calls **fail closed** (safe, but the app's calls break too if the
>   origin isn't listed).
> - `resolve-login` password reset redirects to a local dev origin instead of
>   your deployed app.
>
> Set it to the app's real origin (and any local dev origin you use) before
> deploying.

---

## 3. Deploy the edge functions

Four functions were hardened:

| Function        | What changed                                                                              |
| --------------- | ----------------------------------------------------------------------------------------- |
| `ai-chat`       | Allow-listed CORS via `corsFor(req)` + `req` threaded through all responses               |
| `ai-search`     | Allow-listed CORS via `corsFor(req)` + `req` threaded through all responses               |
| `ai-process`    | CORS hardening **and** SSRF fix: file URL reconstructed from `file_path` pinned to the Supabase storage host (F2) |
| `resolve-login` | CORS hardening **and** open-redirect fail-closed fix: redirects only to an exact `APP_ORIGIN` match (F5) |

### Option A — Supabase CLI (recommended)

The CLI is available in this repo:

```bash
# Link the repo to your Supabase project (one-time, interactive)
npx supabase link --project-ref <YOUR_PROJECT_REF>

# Deploy each function
npx supabase functions deploy ai-chat
npx supabase functions deploy ai-search
npx supabase functions deploy ai-process
npx supabase functions deploy resolve-login

# Set secrets (after deploy; or set in the dashboard)
npx supabase secrets set --env-file .env \
  APP_ORIGIN=https://fuw-e-library.netlify.app
npx supabase secrets set AI_API_KEY=<your-provider-key>
```

### Option B — Dashboard (no CLI)

For each function: **Edge Functions → Select the function → Deploy** from the
function directory, or paste the code, then set the secrets in **Edge
Functions → Secrets**.

### After deploying, verify

```bash
# The project ref is <YOUR_PROJECT_REF>; confirm the functions return 200/4xx
# (not 5xx) for an unauthenticated call. These should NOT be 200 for privileged ops.
curl -i -X OPTIONS \
  -H "Origin: https://fuw-e-library.netlify.app" \
  "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/ai-search" | head -20
# Expect: Access-Control-Allow-Origin echoed back (no '*').

# A cross-origin call from a NON-listed origin must NOT receive CORS headers.
curl -i -X OPTIONS \
  -H "Origin: https://evil.example" \
  "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/ai-search" | head -20
# Expect: NO Access-Control-Allow-Origin header.
```

---

## 4. Deploy the frontend (Netlify)

The SPA is built and published through `netlify.toml` (see §1 commands). The
security headers (CSP, HSTS, nosniff, etc. — CFG-01) ship automatically.

Auth tokens are now held **in memory only** (FL-1 hardening, `src/lib/supabase.ts`):
they are never persisted to `localStorage`/`sessionStorage`, so a script-injection
bug cannot exfiltrate a stored refresh token. Consequence: **users must sign back
in after a full page reload** (there is no server to set httpOnly cookies in this
static SPA + edge-function setup — see the comment in `supabase.ts`).

```bash
npm run build   # -> dist/ (verified clean in repo)
netlify deploy --prod
```

Also see **`RUNBOOK_GIT_HISTORY_PURGE.md`** for removing the leaked
`service_role` key from git history (SEC-01).

---

## 5. Critical: rotate the leaked service_role key (SEC-01)

A service_role key matching the live `.env` value was committed in Git history
(`40679a1`, `7337066`, `dcc3ce8`). service_role bypasses RLS — treat it as
compromised.

1. **Dashboard → Project Settings → API Keys → service_role → rotate.**
2. Update `.env` with the new key.
3. Re-deploy any environment/function that uses `SUPABASE_SERVICE_ROLE_KEY`
   (the platform injects it automatically for edge functions; verify).
4. The guards (`scripts/secret-guard.sh` pre-commit hook and `.gitleaks.toml`)
   are updated to catch the real JWT header, so the key cannot be re-committed.
5. Optionally purge the key from Git history with `git filter-repo` on a fresh
   clone — only do this with explicit owner confirmation, and coordinate the
   rewrite with any collaborators since it rewrites commit SHAs.

---

## 6. Rollback

- **Migration:** restore the pre-migration backup (README §4) if the follow-up
  migration causes issues. It is revoke/policy-only and additive, so rollback
  risk is low.
- **Edge functions:** re-deploy the previous version from the Edge Functions
  deployment history in the dashboard.
