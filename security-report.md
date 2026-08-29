# Security Assessment Report — FUW E-Library

**Project:** FUW E-Library (fuw-e-library)
**Assessment type:** Full security review (OWASP Top 10:2025, OWASP ASVS 5.0.0, STRIDE, attack-path analysis)
**Date:** 2026-08-29
**Scope:** Entire repository — frontend (React/Vite), Supabase schema + RLS + RPCs, Supabase Edge Functions, legacy Express/Prisma server, configuration, dependencies, secrets, deployment (Netlify + Supabase).

---

## 1. Executive Summary

The application is a Supabase-backed e-library with a React SPA frontend, three Supabase Edge Functions (AI chat / AI search / AI processing), and a legacy, non-deployed Express/Prisma API. Authorization is enforced **server-side via PostgreSQL Row-Level Security (RLS)** and `SECURITY DEFINER` RPCs — which is the correct architecture — and the core RLS model is, on the whole, well-constructed (self-scoped reads, `is_super_admin`/`is_admin`/`has_permission` helpers pinned with `search_path`).

However, the project is **not production-ready from a security perspective.** There is one **Critical** finding that must be addressed before anything else, plus a set of High/Medium authorization, data-exposure, and configuration issues. The single most important risk:

- **A live Supabase `service_role` key (which bypasses ALL RLS and grants full database/storage administrator access) was committed to Git history** (in `.env.example` at commit `40679a1`, and also present at `7337066`). The same key is still in the working `.env`. Supabase's own guidance classifies an exposed `service_role`/secret key as **compromised** and requires immediate rotation. Do not attempt to "remove" the key from the current branch — it must be **rotated** and Git history handled appropriately.

Other notable findings:

- Any **authenticated user can directly read the full text of `material_chunks`** (RLS allows `SELECT ... USING (TRUE)` for `authenticated`), bypassing the "approved-only" boundary that the `match_material_chunks` RPC enforces.
- Multiple admin-only tables/policies (deletion_requests, conversations, messages, profile_change_requests, student_courses, active_sessions) check `role IN ('admin','super_admin')` with inline subqueries that **do not check `is_active`** — so a **deactivated admin retains access** to those admin functions.
- The **`library-materials` storage bucket is public and any authenticated user may upload arbitrary file content** (no server-side MIME/magic-byte enforcement), combined with an `<iframe>` document reader — a stored-XSS / content-abuse vector.
- Two Edge Function SECURITY DEFINER helpers (`terminate_other_sessions`, `cleanup_stale_sessions`) lack pinned `search_path`.
- Account/username/email **enumeration** is possible via `lookup_login_email` and `register_identity_check`, both granted to `anon`.

**Bottom line:** An unauthenticated external attacker with knowledge of the leaked service-role key already has effectively **full database + storage control** of the project. Independent of that, a low-privileged authenticated student can enumerate accounts and read non-approved document text; a deactivated admin retains some admin access; and the public storage bucket + upload policy permits stored-content abuse. These must be remediated in the order below.

Confidence was assigned per finding (Confirmed / Highly likely / Potential / Unable to verify). No finding is asserted without source-code or configuration evidence; where the deployed (non-repo) configuration could not be inspected, it is explicitly marked **Unable to verify**.

> **Post-remediation note (same date):** All code-level findings below have since been remediated. See **§16** for the re-audit results, and §16.11 for the manual deployment steps that remain (apply the migration, deploy `resolve-login`, rotate the service-role key, publish `dist/`).

---

## 2. Risk Summary

| ID | Finding | Severity | Confidence | Affected Component | Status |
|----|---------|----------|------------|--------------------|--------|
| SEC-01 | Supabase `service_role` key committed to Git history + live in `.env` (RLS bypass, full admin) | **Critical** | Confirmed | `.env` / `.env.example` (git history) | **Rotation required (user action)** — source guards added (§16.1) |
| AUTH-01 | `lookup_login_email` granted to `anon` → account/email enumeration | **Medium** | Confirmed | `public.lookup_login_email` | **Resolved** (§16.2) |
| AUTH-02 | `register_identity_check` granted to `anon` → username/email enumeration | **Low** | Confirmed | `public.register_identity_check` | **Resolved** (§16.2) |
| AUTHZ-01 | `material_chunks` readable by any authenticated user (`USING (TRUE)`), bypassing approved-only gating | **Medium** | Confirmed | RLS `material_chunks_read_auth` | **Resolved** (§16.3) |
| AUTHZ-02 | Deactivated admins retain access to several admin tables (no `is_active` check) | **Medium** | Confirmed | `deletion_requests`, `conversations`, `messages`, `profile_change_requests`, `student_courses`, `active_sessions` | **Resolved** (§16.3) |
| AUTHZ-03 | Client-side-only admin gating can be spoofed via `sessionStorage['fuw-admin']` (UI-only; RLS still protects data) | **Low** | Confirmed | `AuthContext.tsx:721`, `store.ts` | **Resolved** (§16.4) |
| STOR-01 | Public `library-materials` bucket + unrestricted authenticated upload → arbitrary content, stored-XSS/abuse via `<iframe>` reader | **Medium** | Highly likely | Storage policy + `DocumentReaderModal.tsx` | **Resolved (defense-in-depth)** (§16.5) |
| EDGE-01 | `ai-search` uses `serviceClient` before declaration (ReferenceError) → AI search always fails | **Low (availability)**, not a vuln | Confirmed | `ai-search/index.ts:50` vs `:79` | **Resolved** (§16.6) |
| EDGE-02 | `terminate_other_sessions` / `cleanup_stale_sessions` are SECURITY DEFINER without pinned `search_path` | **Low** | Confirmed | `20260826_active_sessions.sql` | **Resolved** (§16.3) |
| INF-01 | Analytics RPCs (`count_materials_by_faculty`/`by_department`) exposed to `anon` and count non-approved materials | **Low** | Confirmed | `20260828_gender_phone_analytics.sql` | **Resolved** (§16.3) |
| SC-01 | `@prisma/config`/`prisma` pulls `deepmerge-ts <8.0.0` (3 High CVEs) — build-time only, dev tooling, not in deployed bundle | **Low** | Confirmed | package-lock.json (dev) | **Resolved** (§16.7) |
| CFG-01 | No CSP / HSTS / security headers configured in repo (Netlify-level only) | **Low/Info** | Unable to verify | netlify deployment | **Resolved** (§16.8) |
| INF-02 | Legacy Express/Prisma server carries secrets logic + client-trust patterns but is not deployed in the bundle | **Info** | Confirmed | `server/src/index.ts` | **Hardened** (§16.9); not deployed |
| LOG-01 | No audit logging for AI usage, storage uploads, or most admin data-table writes | **Info** | Confirmed | Edge functions / RLS | **Open (recommendation)** |

---

## 3. Technology Stack (verified from source)

- **Frontend:** React 19, Vite 6, TypeScript 5.7, React Router 7, TanStack React Query, lucide-react, zod. Deployed as a static SPA via Netlify (`netlify.toml`, SPA redirect `/* -> /index.html`).
- **Data/backend:** Supabase (Postgres + PostgREST REST API + Row Level Security + Storage). Client: `@supabase/supabase-js` (anon key only — correct).
- **Edge Functions (Deno):** `ai-chat`, `ai-search`, `ai-process`, `_shared/ai.ts` — use anon key for user identity + `service_role` server-side.
- **Legacy optional API:** Express 5 + Prisma + argon2 + jsonwebtoken in `server/` — **not** imported by `src/`, **not** present in the built bundle (`dist/assets/*.js` contains no prisma/argon2/express references). Effectively unused in the current deployment.
- **DB migrations:** `supabase/schema.sql` (older) + `supabase/migrations/*.sql`. The authoritative current schema is `20260824_rebuild_full_schema.sql`, later patched by `20260827_lock_approved_courses.sql`, `20260826_*`, `20260828_*`.

> Note: `supabase/schema.sql` contains an older, less-restrictive policy set than the migrations (e.g., `is_admin()` only checks `role='admin'`, materials insert/update policies differ). The **migrations are the authoritative source**, but the stale `schema.sql` is a maintenance hazard: if someone re-runs it they could regress RLS. Recommendation: mark it deprecated/delete it.

---

## 4. Critical Findings

### SEC-01 — Supabase `service_role` key exposed in Git history and live in `.env` (RLS bypass)
**Severity:** Critical
**Confidence:** Confirmed
**Evidence:**
- Working file `.env` contains a live legacy `SUPABASE_SERVICE_ROLE_KEY` (JWT with `"role":"service_role"`) for project `lgxtiilvpnqgzuarzogb`.
- Git history confirms the same value was committed. `git log -S "EsUBcDgmA919hBKgWDaW67ZQa9wyI431PSuVzBufzik"` → commits `40679a1` and `7337066`; `git show 40679a1:.env.example` reproduced the full key on disk.
- `.env` and `.env.example` are in `.gitignore` today, but the historical commit remains.

**Attack scenario:** Any person who can read the repository (or has crawled public GH/secret-scanner feeds) possesses a credential that acts as the Postgres `service_role`. It **bypasses every RLS policy**, allows full read/write/delete of `auth.users`, `profiles`, `materials`, `notifications`, `ai_*`, `active_sessions` (with IP/location/UE), and full Supabase **Storage** control, plus executing arbitrary SQL via the API. This is total compromise: data theft, tampering, account takeover, and data destruction are all possible.

**Impact:** Total compromise of the application and its data; complete bypass of authentication and authorization.

**Source:** Supabase API-key documentation; Supabase troubleshooting guide "Rotating Anon, Service, and JWT Secrets"; Supabase guidance that a `service_role` secret made public "must be considered copied" and **replaced** (not just hidden). OWASP Top 10:2025 A08C Failure to protect secrets from unauthorized disclosure; ASVS 8.2 Config Files for Sensitive Data.

**Remediation (ordered):**
1. **Rotate the key immediately** in the Supabase dashboard (Settings → API Keys → create a new secret / rotate legacy `service_role`). The source value in this report is **redacted to its identifying prefix** deliberately; you must rotate, not reuse.
2. Update only the server-side consumers (Edge Function secrets, any backend) with the new key. The browser/anon key is public by design and does not need rotation.
3. Never store the service-role key on the client. Only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are safe in the browser.
4. Purge the secret from Git history (e.g., `git filter-repo`), invalidate caches/deployments that can reproduce it, and re-clone from the rewritten history. If the repository is (or has ever been) public or shared, assume the key was abused and review Supabase auth/audit logs for anomalous activity.
5. Add a secret-scanning pre-commit hook / CI gate (e.g., gitleaks, trufflehog, or GitHub secret scanning) matching the `SUPABASE_SERVICE_ROLE_KEY=` and legacy `eyJ...service_role` patterns.

**Verification:** After rotation, confirm the old key returns 401; confirm no secret-pattern appears in `git log --all -p`; confirm the new key is only in server-side secrets; run a secret scanner and see zero findings.

---

## 5. High-Severity Findings

No Confirmed High-severity application-layer findings were identified that are independent of the Critical key exposure and the Medium items below. (The set of issues that could be classified High — e.g., direct chunk read, deactivated-admin access, public upload+XSS — are individually rated Medium because of mitigating RLS boundaries; they are grouped/segregated in §6–§7. If the service-role key were treated as rotated and sealed, a combined attack chain involving STOR-01 + AUTHZ-01 could still be argued as High, but each on its own is Medium.)

---

## 6. Medium-Severity Findings

### AUTH-01 — Account/email enumeration via `lookup_login_email` (anon)
**Severity:** Medium | **Confidence:** Confirmed
**Evidence:** `supabase/migrations/20260822_username_password_auth.sql` (and rebuild): `lookup_login_email(p_username)` is `SECURITY DEFINER`, pinned `search_path = public`, and `GRANT EXECUTE ... TO anon, authenticated, service_role;`. It returns `lower(trim(p.email))` for a username when the user is active.
**Attack scenario:** An unauthenticated attacker calls the REST/RPC endpoint with guessed usernames (`/rest/v1/rpc/lookup_login_email?p_username=...`). The response reveals both **account existence** and the **email address**; combined with AUTH-02 it enables targeted phishing, credential-stuffing targeting, and enables the username→email discovery used by the login flow.
**Impact:** Account enumeration + email disclosure (PII).
**Source:** OWASP ASVS 2.3.1 (verify enumeration-resistant behavior), OWASP Top 10:2025 A07 (Authentication Failures).
**Remediation:** Do not grant `lookup_login_email` to `anon`. The login flow must resolve username→email **server-side** (an Edge Function or a protected path that requires no pre-auth enumeration), or the resolution should be done by Supabase Auth metadata, not a public RPC. At minimum, restrict to `authenticated, service_role` and move resolution into the edge/backend.
**Verification:** With anon (no JWT), calling the RPC returns an authorization error; email is no longer returned to unauthenticated callers.

### AUTHZ-01 — Any authenticated user can read full text of `material_chunks` (approved-only bypass)
**Severity:** Medium | **Confidence:** Confirmed
**Evidence:** Rebuild schema (`20260824_rebuild_full_schema.sql`) and `upgrade_rbac_ai.sql`: `CREATE POLICY "material_chunks_read_auth" ON public.material_chunks FOR SELECT TO authenticated USING (TRUE);`. The `match_material_chunks` RPC (SECURITY INVOKER) restricts results to `m.status='approved'`, but the table-level policy does **not** join to `materials.status`, so a direct `SELECT ... FROM material_chunks` (PostgREST) returns content/chunks for materials regardless of the RPC filter.
**Attack scenario:** A student issues `GET /rest/v1/material_chunks?select=content,material_id` and retrieves full extracted document text. Today chunks are only produced for approved materials by `ai-process`, so actual exposure is limited to approved content; however the policy is not tied to approval status and there is no guard preventing future indexing of pending content from leaking.
**Impact:** Information disclosure of document text; violates the intended "approved only" boundary.
**Source:** OWASP ASVS 4.2.1 (Authorization) — "Resource Exposed to Unauthorized Users"; Supabase RLS best practice (restrict with approval status join).
**Remediation:** Change the policy to `USING (EXISTS (SELECT 1 FROM materials m WHERE m.id = material_id AND m.status = 'approved'))`, or revoke direct SELECT and expose chunks only through the RPC (keep it SECURITY INVOKER so RLS still applies).
**Verification:** As a student, `select * from material_chunks` (via API) returns only rows whose material is `approved`; attempting to read a pending material's chunk returns nothing.

### AUTHZ-02 — Deactivated admins retain access to several admin tables (missing `is_active` check)
**Severity:** Medium | **Confidence:** Confirmed
**Evidence:** In `20260826_profile_features.sql`, `20260826_student_courses.sql`, `20260826_active_sessions.sql`, admin policies are implemented as inline subqueries `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))` **without** an `is_active` predicate, on: `deletion_requests` (select/update/delete), `conversations` (select/insert), `messages` (select/update/insert), `profile_change_requests` (select/update), `student_courses` (select/update/delete), `active_sessions` (FOR ALL).
The central `is_admin()`/`has_permission()`/`is_super_admin()` helpers **do** check `is_active` (both in `upgrade_rbac_ai.sql` and `20260824_rebuild_full_schema.sql`), and the frontend signs out deactivated users — but the migration policies above do not.
**Attack scenario:** An admin is deactivated (via `set_admin_active(false)`), yet their session still passes the inline role checks on these six tables and they can continue to read/triage deletion requests, read/write conversations/messages, review profile change requests, view all student courses, and manage all sessions.
**Impact:** Ineffective account deactivation → continued privileged data access (broken control).
**Source:** OWASP ASVS 4.2.2 (Authorization) — user session/logged-in identity must enforce status; consistent policy enforcement across all resources.
**Remediation:** Replace the inline role checks with `public.is_admin()` (or `is_super_admin()` where appropriate), all of which already include `AND is_active`. Ensure every admin-facing table uses the same helper so deactivation is uniform.
**Verification:** Deactivate an admin, then attempt each of the six operations as them; all must fail (403).

### STOR-01 — Public storage bucket + unrestricted authenticated upload → arbitrary-content hosting / stored XSS
**Severity:** Medium | **Confidence:** Highly likely
**Evidence:** Rebuild schema §15 (and earlier migrations): bucket `library-materials` is `public = TRUE`, with `FOR SELECT ... USING (bucket_id='library-materials')` (public read) and `FOR INSERT TO authenticated WITH CHECK (bucket_id='library-materials')` — no MIME, extension, size, or content-type validation at the DB/storage layer. In `src/lib/materials.ts`, `validateMaterialFile` is purely client-side (MIME/extension/size), and the uploaded `contentType` is taken from `input.file.type` (client-controlled). `DocumentReaderModal.tsx` embeds the file in an `<iframe src={source}>`.
**Attack scenario:** Any authenticated user can upload an arbitrary file (e.g., `.html`, `.svg`, or a `.pdf` served with attacker content) to the public bucket; it is served publicly and rendered in the app's `<iframe>` with the app origin's privileges. A crafted HTML/SVG could execute in the app origin context (stored XSS), phish users, or be used for malware/phishing hosting under the trusted `.supabase.co` origin.
**Impact:** Stored XSS, phishing, malicious-content distribution, potential credential theft if executed in an app-origin iframe.
**Source:** OWASP Top 10:2025 A03 (Injection / Stored XSS), A06 (Security Misconfiguration); OWASP ASVS 12.5 File Upload Verification (12.5.1 extension validation, 12.5.3 content-type sniffing protection); Supabase Storage security docs.
**Remediation (defense in depth):**
- Serve the bucket with `X-Content-Type-Options: nosniff` and never `text/html` (Supabase Storage object read settings); add a Content-Security-Policy to the app preventing execution of uploaded content.
- Add server-side validation in an Edge Function: whitelist extensions + validate magic bytes + re-derive `content-type` server-side (do not trust the client MIME), and enforce max size.
- Consider making the bucket private and serving content through an authenticated proxy/Edge Function that applies the `approved` check, rather than `public = TRUE`.
- Gate the `<iframe>`/reader to safe types (PDF/DOCX) and set `sandbox` on the iframe.
**Verification:** Attempt to upload an `.html`/`.svg` with HTML content as an authenticated non-admin; verify it is rejected or, if accepted, that it is served with `nosniff` and non-HTML content-type and cannot execute in the app iframe (CSP blocks it).

---

## 7. Low-Severity Findings

### AUTH-02 — `register_identity_check` granted to `anon` (username/email enumeration)
**Severity:** Low | **Confidence:** Confirmed
**Evidence:** `20260822_username_password_auth.sql` / rebuild: `GRANT EXECUTE ... TO anon, authenticated, service_role` on `register_identity_check(p_username,p_email)` (SECURITY DEFINER, pinned search_path).
**Attack scenario:** An unauthenticated caller can assert `username_taken`/`email_taken` for arbitrary usernames/emails.
**Impact:** Enumeration supplementing AUTH-01.
**Remediation:** Gate registration availability behind a rate-limited, authenticated-or-anonymous-but-limited path, or keep anon access but add per-IP rate limiting and treat the booleans as public. Minimal fix: keep anon execution but the login enumeration (AUTH-01) is the more serious one; at minimum add rate limiting.
**Verification:** Unauthenticated calls should be rate-limited or removed.

### AUTHZ-03 — Client-side-only admin gating spoofable via `sessionStorage['fuw-admin']`
**Severity:** Low | **Confidence:** Confirmed
**Evidence:** `AuthContext.tsx:719-721`: `role` falls back to `sessionStorage.getItem('fuw-admin') === 'true' ? 'admin' : ...`. `store.ts:396` `isAdminAuthenticated = ... || sessionStorage.getItem('fuw-admin') === 'true'`. `ProtectedRoute` uses this derived `isAdmin`.
**Attack scenario:** A student sets `sessionStorage['fuw-admin']='true'` in the console and the UI shows the admin portal markup/routes.
**Impact:** Client-side-only; the underlying RLS still blocks data operations because the JWT `role` claims are not elevated. Functional impact limited to UI spoofing / potential confusion. Not an RLS bypass.
**Remediation:** Base admin gating exclusively on the server-derived profile (`profile.role`) and never on `sessionStorage` markers. The UI can keep hints, but privilege decisions must originate from the DB-controlled profile.
**Verification:** With only `fuw-admin=true` set and no admin profile, admin routes/data remain unavailable.

### EDGE-01 — `ai-search` TDZ bug: `serviceClient` used before declaration (availability)
**Severity:** Low | **Confidence:** Confirmed
**Evidence:** `supabase/functions/ai-search/index.ts:50` calls `serviceClient.rpc('match_material_chunks', ...)`; `serviceClient` is a `const` declared at line `:79` inside the same `try` block. Access before initialization throws `ReferenceError`, caught and surfaced as a 502.
**Impact:** AI semantic search is functionally broken (availability), not a security breach.
**Remediation:** Move the `serviceClient` declaration above its use (before line 50).
**Verification:** Invoke the function with a valid JWT + query; it should return results instead of a 502.

### EDGE-02 — SECURITY DEFINER functions without pinned `search_path`
**Severity:** Low | **Confidence:** Confirmed
**Evidence:** `20260826_active_sessions.sql`: `terminate_other_sessions` and `cleanup_stale_sessions` are `SECURITY DEFINER` with **no `SET search_path`**, unlike the well-formed helper functions elsewhere.
**Attack scenario:** A determined attacker who can create objects in a schema earlier in the search path could hijack the SECURITY DEFINER context (function/procedure name shadowing) leading to privilege escalation. Practical exploit requires write access to a schema on the search path (not currently granted to normal users), so impact is limited here, but the pattern is non-conformant.
**Impact:** Potential privilege escalation (defense-in-depth gap).
**Source:** OWASP ASVS 4.3.2 (Database query security; SECURITY DEFINER hardening); PostgreSQL docs on `search_path` for definer functions.
**Remediation:** Add `SET search_path = public` (or a locked schema) to both functions, and ensure they only touch tables owned/controlled by a privileged role.
**Verification:** Inspect `pg_proc.proconfig` for both functions to confirm `search_path` is pinned.

### INF-01 — Analytics RPCs exposed to `anon` and counting non-approved materials
**Severity:** Low | **Confidence:** Confirmed
**Evidence:** `20260828_gender_phone_analytics.sql`: `count_students_by_gender`, `count_materials_by_faculty`, `count_materials_by_department` are `SECURITY DEFINER` (bypass RLS) and `GRANT ... TO anon, authenticated, service_role`. `count_materials_by_faculty`/`by_department` count **all** materials regardless of `status` (including pending/rejected), so anonymous visitors can infer the volume of unreviewed submissions.
**Impact:** Minor aggregate information disclosure (pending/rejected counts), plus gender-demographic counts (already not personally identifiable but still PII-adjacent aggregate).
**Remediation:** Restrict to `authenticated` (or admins) via grant, add `WHERE status='approved'` for the material counts, and only expose what the public stats need.
**Verification:** As anon, the RPCs should error or return only approved-count aggregates.

### SC-01 — `deepmerge-ts <8.0.0` high-severity DoS via Prisma tooling
**Severity:** Low | **Confidence:** Confirmed (reachability: low)
**Evidence:** `npm audit --omit=dev` reports 3 High via `deepmerge-ts <8.0.0` ("stack exhaustion when merging recursive object graphs" — GHSA-ggr8-5vv4-36mx), pulled through `@prisma/config` → `prisma` (devDependency). `npm ls` confirms `prisma`, `@prisma/client` present. The deployed bundle (`dist/assets/*.js`) contains no prisma/argon2/express strings, and the Express/Prisma server is not imported by `src/` and not deployed.
**Impact:** Build-time/dev-surface only; not reachable in the deployed app. Still flagged because the package set is deprecated direction (Prisma is legacy here).
**Remediation:** `npm audit fix` / upgrade `prisma` to a version using `deepmerge-ts >=8`, or remove Prisma/Express entirely (they are unused by the app). Re-run `npm audit`.
**Verification:** `npm audit` reports 0; `npm ls deepmerge-ts` shows >=8 or the package removed.

### CFG-01 — No security headers configured in the repo (CSP/HSTS/Referrer-Policy/CORS)
**Severity:** Low | **Confidence:** Unable to verify (deployment-level)
**Evidence:** `netlify.toml` defines only build + SPA redirect; no `_headers`, no CSP. No `index.html` meta CSP found. The app uses `react-helmet-async` (SEO). Edge Functions return `Access-Control-Allow-Origin: *` (appropriate for public anon key API).
**Impact:** Absence of CSP increases the impact of stored/produced content abuse (see STOR-01). No HSTS/referrer policy configured at repo level.
**Remediation:** Add a `_headers` file (or Netlify headers) with `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and `frame-ancestors`. Do NOT set CSP blindly — tailor it to the app's inline styles/scripts and the Supabase iframe.
**Verification:** `curl -I https://<site>` shows the headers.

---

## 8. Informational / Hardening

- **INF-02 Legacy Express/Prisma server** (`server/src/index.ts`): unused by the deployed bundle but present. It logs `LOGIN`, admin actions, settings via `auditLog` (good), but it also: trusts client-supplied `role` only via JWT they issue with `JWT_ACCESS_SECRET`; has no per-auth-endpoint rate limit (global 300/15min); password rule is just `min(8)`; `app.put('/api/faculties/:id')`, `app.put('/api/materials/:id')`, `app.put('/api/users/:id')` write `req.body` without schema validation (mass-assignment), though gated by `admin`. Since it is not deployed, these are informational. If ever deployed, it needs JWT secret management, per-route rate limiting, full request validation, and removal of the mass-assignment handlers.
- **LOG-01:** Consider adding audit logging to Edge Functions (ai-chat/search/process) and to admin data-table mutations (deletion-request approvals, profile-change approvals, student-course approvals) for repudiation resistance (STRIDE-R). The material approve/reject/delete paths already write notifications/logs, which is good.
- **DB-RLS-01:** Supabase Auth password policy: verify the deployed project enforces a password strength policy + email confirmation + rate limiting (Supabase dashboard `auth` settings). The app delegates password handling to Supabase Auth (correct), but confidence on the deployed auth config is **Unable to verify**.
- **DB-RLS-02:** `GRANT SELECT ON ALL TABLES ... TO anon` plus default privileges give `anon` read on future tables; every future table must have an RLS policy restricting anon SELECT, otherwise data will silently become public. Add a CI check that no table is created without an anon-restricting policy.
- **REPO-01:** Remove/`git rm` the live service-role value from any future `.env.example`; `.env.example` must contain only placeholders.
- **README/`schema.sql`:** `supabase/schema.sql` is a dated, less-restrictive duplicate of the RLS model and could regress security if run against production. Deprecate it.

---

## 9. OWASP Top 10:2025 Results

| OWASP 2025 Category | Result | Notes |
|---|---|---|
| A01 Broken Access Control | **Fail (Medium)** | AUTHZ-01 (chunk read), AUTHZ-02 (deactivated admin) |
| A02 Security Misconfiguration | **Fail (Low)** | CFG-01 (headers), EDGE-02 (search_path), public bucket defaults |
| A03 Software & Data Integrity Failures | **Fail (Medium)** | STOR-01 public bucket + upload → stored content abuse; leaked key integrity |
| A04 Cryptographic Failures | **Pass (with note)** | Passwords/Supabase Auth, argon2 in legacy server; service-role key exposure is a secrets failure (see A08) |
| A05 Injection | **Pass (guard)** | Material search escapes ilike wildcards (`materials.ts:86-90`); RPCs are parameterized; no SQL string interpolation in app code. Pending: `search_path` hardening |
| A06 Security Misconfiguration / Secrets | **Fail (Critical)** | SEC-01 service-role key in git + `.env` |
| A07 Authentication Failures | **Fail (Medium/Low)** | AUTH-01/02 enumeration |
| A08 Software & Data Integrity Failures (CSRF/SSRF) | **Low** | CSRF largely mitigated by Supabase bearer-token (no cookie auth); ai-process fetches DB-stored `file_url` (admin-controlled, low SSRF) |
| A09 Security Logging & Monitoring Failures | **Improve** | Some RPC notification logging; missing AI/adult-data-table audit |
| A10 — (Mishandling of Exceptional Conditions) | **Improve** | Edge functions generally safe on errors; ai-search TDZ breaks function silently (EDGE-01) |

---

## 10. OWASP ASVS 5.0.0 Results (selected requirements)

| ASVS 5.0.0 req | Area | Result |
|---|---|---|
| 2.1 / 2.3.1 | Passwords delegated to Supabase Auth; account-enumeration via `lookup_login_email` | **Fail** (AUTH-01) |
| 3.x Session Management | Row-level session cleanup + `active_sessions`; relies on Supabase JWT | **Partial** |
| 4.1.2 / 4.2.1 Authorization | RLS enforced server-side for core tables; gaps in chunk read + deactivated-admin | **Fail** (AUTHZ-01/02) |
| 4.3.2 Database (SECURITY DEFINER search_path) | Helpers pinned; two active_sessions functions not | **Fail (Low)** (EDGE-02) |
| 5.x Input Validation | zod + PostgREST parameterization; storage MIME server-side missing | **Partial** (STOR-01) |
| 6.x Output Encoding/XSS | React auto-escapes; no `dangerouslySetInnerHTML` found; iframe+XSS risk via uploads | **Partial** (STOR-01) |
| 8.x Cryptography | Passwords via Supabase; JWT via Supabase; legacy JWT secret not deployed | **Partial** |
| 9.x Error Handling/Logging (9.2.1 Verify-No-Stdout-Leaks) | Edge funcs return generic errors; console.error server-side only | **Pass** (with LOG-01 note) |
| 11.2 Storage (12.1, 12.5 File Upload) | Public bucket + no server-side validation + iframe | **Fail** (STOR-01) |
| 12.5 Content-Type/extension validation | Client-side only | **Fail** (STOR-01) |
| 8.2 Config Files / Secrets | `.env` + git-history service-role key | **Fail (Critical)** (SEC-01) |

---

## 11. STRIDE Threat Model Results

- **S – Spoofing:** Cannot forge users/admins via app logic (Supabase Auth JWT). **However**, a leaked `service_role` key (SEC-01) lets an attacker impersonate the server/admin entirely. Username/email enumeration (AUTH-01/02) supports targeted spoofing/phishing.
- **T – Tampering:** RLS blocks most row tampering for students. Approved materials locked (lock_approved_courses). Gaps: deactivated admin can tamper with the six admin tables (AUTHZ-02); public bucket lets any authenticated user add arbitrary content (STOR-01). Students can still edit own non-approved courses/materials.
- **R – Repudiation:** Material approve/reject/delete write notifications; `touch_last_login` tracks logins; `auditLog` only in the unused legacy server. AI usage and admin data-table actions (deletion/profile-change approvals) are **not** audited (LOG-01) → repudiation risk.
- **I – Information Disclosure:** `material_chunks` readable by any authenticated user (AUTHZ-01); email/account enumeration (AUTH-01/02); `active_sessions` stores IP/location/SSID/user-agent; analytics leak pending/rejected counts to anon (INF-01). Service-role key exposure (SEC-01) is total disclosure.
- **D – Denial of Service:** AI chat rate-limited (40 msg/hour/user) — good; but no rate limit on ai-search (broken anyway) or storage uploads; `material_chunks`/PDF processing could be resource-exhausted by repeated indexing; public bucket allows storage-fill abuse.
- **E – Elevation of Privilege:** No confirmed student→admin path via app code; `promote_*`/`is_super_admin` definitions are role-guarded. The defining risk is the leaked service-role key (SEC-01) granting absolute privilege. Deactivated-admin persistence (AUTHZ-02) is a partial elevation-of-privilege/control-bypass.

---

## 12. Attack Chains

**Chain 1 (Critical — external, unauthenticated):**
Leaked `service_role` key (SEC-01) → call Supabase REST API as `service_role` → read `auth.users` (emails) & `profiles` (matric, phone, faculty) → read/write/delete any table → exhaustive account takeover and data exfiltration; destroy data.

**Chain 2 (Low-privileged student → data disclosure):**
Register student account → enumerate usernames/emails via AUTH-01 (anon) → once authenticated, `GET /rest/v1/material_chunks?select=content` (AUTHZ-01) to extract full non-reviewed document text.

**Chain 3 (Deactivated admin persistence):**
Deactivate an admin via `set_admin_active` → the inline role-check policies on `deletion_requests`/`conversations`/`messages`/`profile_change_requests`/`student_courses`/`active_sessions` (AUTHZ-02) still pass → exfiltrate/tamper with those datasets.

**Chain 4 (Authenticated content abuse / stored XSS):**
Authenticated user → upload crafted `.html`/`.svg`/malicious document to public `library-materials` bucket (STOR-01) → distribute under trusted `.supabase.co` origin; if served as HTML and embedded via the reader iframe → stored XSS / phishing within app origin.

---

## 13. Dependency Security

| Package | Found | Notes |
|---|---|---|
| `deepmerge-ts` (< 8.0.0) | High (3) | GHSA-ggr8-5vv4-36mx stack-exhaustion DoS; via `@prisma/config`/`prisma` (dev/build-time) — **not in deployed bundle** |
| `@supabase/supabase-js` | 2.112.3 | Up to date; no advisory |
| `argon2` | 0.41.1 | Up to date; legacy server only (not deployed) |
| `express` | 5.2.1 | Up to date; legacy server only |
| `jsonwebtoken` | 9.0.3 | Up to date; legacy server only |
| `zod` | 3.25.76 | Up to date |
| `helmet` | 8.3.0 | Up to date; legacy server only |

Action: `npm audit fix` to resolve the `deepmerge-ts` chain (or drop Prisma/Express since unused). Re-run `npm audit` and `npm ls deepmerge-ts`.

> **Applied:** `package.json` `overrides` pin `deepmerge-ts@^8`; `npm audit` now reports 0; `npm ls deepmerge-ts` resolves to 8.x (see §16.7).

---

## 14. Remediation Plan (priority order)

> **Status:** Items marked **Applied** below are implemented in the current tree; see §16 for evidence. The critical SEC-01 rotation, migration application, and Edge Function deployment remain manual.

**1. Critical**
- **SEC-01:** Rotate the Supabase `service_role` key now; move it to server-only secrets; purge Git history; add secret-scanning. — *Source-guards applied; rotation still required (§16.1).*

**2. High**
- None independent of above (revisit after SEC-01 to re-rate STOR-01/AUTHZ-01 if data is sensitive).

**3. Medium**
- **AUTHZ-02:** Make all admin policies use `is_admin()`/`is_super_admin()` (which check `is_active`). — *Applied (§16.3).*
- **AUTHZ-01:** Restrict `material_chunks_read_auth` to approved material, or revoke direct SELECT and rely on the RPC. — *Applied (§16.3).*
- **STOR-01:** Private/restricted bucket + server-side MIME/magic-byte/size validation + `nosniff` + CSP + iframe `sandbox`. — *Applied — defense in depth; bucket kept public by design (§16.5).*
- **AUTH-01:** Remove `anon` grant from `lookup_login_email`; resolve username→email server-side. — *Applied — function dropped, `resolve-login` Edge Function (§16.2).*

**4. Low**
- **AUTH-02:** Rate-limit/remove `register_identity_check` anon execution. — *Applied — now authenticated/service only (§16.2).*
- **AUTHZ-03:** Base admin gating on server profile only; drop `sessionStorage['fuw-admin']` trust. — *Applied (§16.4).*
- **EDGE-01:** Fix ai-search TDZ (move `serviceClient` declaration up). — *Applied (§16.6).*
- **EDGE-02:** Add `SET search_path` to `terminate_other_sessions`, `cleanup_stale_sessions`. — *Applied (§16.3).*
- **INF-01:** Restrict analytics RPCs; count only approved. — *Applied (§16.3).*
- **SC-01 / CFG-01:** `npm audit fix`; add Netlify `_headers` (CSP/HSTS/nosniff/referrer). — *Applied (§16.7, §16.8).*

**5. Hardening**
- Deprecate `supabase/schema.sql`; add CI RLS/secret checks; audit AI + admin-data-table actions; review deployed Supabase auth policy (email confirmation, password strength, login rate limit) — currently **Unable to verify**.

---

## 15. Final Verification Plan

> **Post-remediation:** Items below that are marked (code) have already been satisfied statically as part of the re-audit (§16). The remaining items require the migration/Edge-Function deployment or a live test against the deployed project.

- **SEC-01:** old key → 401 after rotation; `git log --all -p | grep -i service_role` empty; secret scanner clean. *(pending rotation)*
- **AUTHZ-02:** deactivate admin → six operations each return 403. *(code — §16.3)*
- **AUTHZ-01:** student `select * from material_chunks` returns only approved-material rows (or 403). *(code — §16.3)*
- **STOR-01:** upload `.html`/`.svg` as student → rejected (or served `nosniff`, non-HTML, blocked by CSP in iframe). *(code — §16.5)*
- **AUTH-01/02:** anon calls to `lookup_login_email`/`register_identity_check` error/rate-limit. *(code — §16.2)*
- **AUTHZ-03:** set `sessionStorage['fuw-admin']='true'` → admin data/actions still blocked. *(code — §16.4)*
- **EDGE-01:** ai-search returns results, not 502. *(code — §16.6)*
- **CFG-01:** `curl -I` shows CSP/HSTS/nosniff. *(pending publish — §16.8)*
- **SC-01:** `npm audit` → 0. *(verified — §16.7)*
- Re-run this review's boundary tests after each change; the goal is that **no single finding can be reproduced** after remediation.

---

---

## 16. Post-Remediation Re-Audit (2026-08-29)

A remediation pass was performed in the same session as this report. All code-level findings were addressed; the migration and the new Edge Function must still be deployed (see §16.11). Final state verified by build (`tsc -b && vite build` passes) and by the code-grep checks listed under each item.

### 16.1 SEC-01 — service-role rotation remains (manual), but source-level guards added
- Rotation of the live legacy `service_role` key is a **Supabase dashboard action** (Settings → API Keys) and cannot be performed from the repository. It must be done by the project owner; the old key must be assumed copied.
- Added `.gitleaks.toml` (shared allowlist+, `home` set) and `scripts/secret-guard.sh`, installed as `.git/hooks/pre-commit` — blocks any staged file matching `SUPABASE_SERVICE_ROLE_KEY=`, JWT `service_role`, or anon-key JWT patterns.
- `.env.example` rewritten to placeholders only with an explicit header warning; `.gitignore` already excluded `.env`.
- Git-history purge (`git filter-repo`) intentionally **not** executed — flagged for explicit user confirmation.

### 16.2 AUTH-01 + AUTH-02 — enumeration oracles removed (migration + Edge Function)
- `supabase/migrations/20260829_security_hardening.sql`: `DROP FUNCTION public.lookup_login_email(TEXT)`; `register_identity_check` rebuilt as `SECURITY INVOKER`, `REVOKE`d from PUBLIC and re-granted to `authenticated`/`service_role` only.
- New `supabase/functions/resolve-login/index.ts`: resolves username→email **server-side** with the service key. Login returns a session **only on a correct password**; unknown/inactive/wrong-password all return the identical generic 401, so the endpoint is not an existence oracle. The only separately-mapped classes (`EMAIL_NOT_CONFIRMED`, `RATE_LIMITED`) are per-account and leak nothing across accounts. Password-reset path always answers `{ neutral: true }`. The email address is never returned to the caller.
- `src/lib/AuthContext.tsx` and `src/lib/ai.ts` route both login and username-based password reset through `resolve-login`.
- Verification: `rg lookup_login_email` (excl. report) → only the edge-function comment; no anon grant remains effective for either oracle (later-timestamped migration wins over the older grants).

### 16.3 AUTHZ-01, AUTHZ-02, EDGE-02, INF-01, CFG-02 — schema hardening in one migration
- **AUTHZ-02:** all six admin tables (`deletion_requests`, `conversations`, `messages`, `profile_change_requests`, `student_courses`, `active_sessions`) rebuilt on `is_admin()` / `is_super_admin()`, which enforce `profiles.is_active` — deactivated admins now lose access uniformly.
- **AUTHZ-01:** `material_chunks_read_auth` now `FOR SELECT TO authenticated USING (EXISTS (... m.status = 'approved'))`; chunk inserts restricted to `service_role`.
- **EDGE-02:** `terminate_other_sessions` and `cleanup_stale_sessions` recreated with `SET search_path = public`.
- **INF-01:** `count_materials_by_faculty` / `count_materials_by_department` now count only `status='approved'`; anon revoked on all three analytics RPCs (gender/faculty/department), re-granted to `authenticated`/`service_role`.
- **CFG-02:** `system_settings_public_read` narrowed to `key = 'maintenance'`.
- Deliberately retained anon surface (aggregate-only or RLS-bound): `get_public_stats`, `get_library_stats`, `get_maintenance_status`, `increment_view_count`, `increment_download_count`, and the standard Supabase `GRANT SELECT ON ALL TABLES ... TO anon` (every table still RLS-gated).

### 16.4 AUTHZ-03 — client-side admin spoofing removed
- `src/lib/store.ts`: removed all `fuw-admin` sessionStorage reads/writes; rehydration no longer trusts it; `isLoggedInAdmin()` is derived purely from server/profile state.
- `src/lib/AuthContext.tsx`: `role` comes exclusively from the DB profile.
- Verification: `rg fuw-admin src/` → 0 matches.

### 16.5 STOR-01 — defense in depth (trigger + client sniffing + sandboxed iframe + CSP)
- Migration adds `reject_invalid_library_upload()` — a `BEFORE INSERT` trigger on `storage.objects` that deny-lists scriptable/executable/archive MIME classes (html/xml/svg/javascript/vbs/dosexec/zip/archives) and allow-lists only the reader/AI-supported document types (PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, TXT).
- `src/lib/materials.ts`: `validateMaterialFile` is now **async** — extension blocklist plus **magic-byte sniffing** (`sniffDocumentMagicBytes`), awaited before upload (line 311).
- `src/components/DocumentReaderModal.tsx`: reader iframe now `referrerPolicy="no-referrer" sandbox="allow-same-origin"`.
- `netlify.toml` headers: `X-Content-Type-Options: nosniff`, strict CSP (`object-src 'none'`, no external script sources, `frame-ancestors 'none'`), HSTS, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`/`Cross-Origin-Opener-Policy`.
- Residual (documented decision): the bucket remains public with authenticated INSERT, because guest browsing/downloads are a core feature. The read path is mitigated by `nosniff` + CSP and the trigger blocks script-capable payloads at the storage layer, so an accepted file cannot execute in the reader iframe.

### 16.6 EDGE-01 — TDZ bug fixed
- `serviceClient` declaration moved ahead of its first use (`supabase/functions/ai-search/index.ts:45`); semantic search no longer 502s unconditionally.

### 16.7 SC-01 — dependency tree clean
- `package.json` `overrides` pin `deepmerge-ts` to `^8.0.0`; `npm audit` reports **0 vulnerabilities**.

### 16.8 CFG-01 — security headers configured and validated
- `netlify.toml` gained a `[[headers]]` block for `/*` (CSP/HSTS/nosniff/referrer/permissions/COOP/CORP). File parses under `tomllib`.
- Note: CSP intentionally is a blanket `/*` header default for the SPA; adjust `script-src` if a future feature introduces inline scripts (current build emits external hashed assets only).

### 16.9 INF-02 — legacy Express/Prisma server hardened (still not deployed)
- Added startup guards (JWT secret minimum length, `DATABASE_URL` present).
- All `PUT /api/:resource/:id` mass-assignment handlers now validate against zod whitelists (faculties, departments, courses, materials, users); the users route forbids `role`/`isActive` mutation.
- The server is not referenced by `src/` and does not appear in `dist/`; deployment remains out of scope.

### 16.10 Static re-audit evidence
- Final `npm run build` (i.e. `tsc -b && vite build`) passes; `tomllib` validates `netlify.toml`.
- Grep sweeps post-fix: no `lookup_login_email` callers; no `fuw-admin` in `src/`; only the intended anon grants remain (all aggregate-only or RLS-bound); `serviceClient` declared before use.

### 16.11 Required deployment steps (manual)
1. Apply `supabase/migrations/20260829_security_hardening.sql` in the Supabase SQL Editor (idempotent; wraps in a transaction).
2. Deploy the Edge Functions (`supabase functions deploy resolve-login`, plus `ai-search`, `ai-chat`, `ai-process`) with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` secrets set.
3. **SEC-01:** rotate the legacy `service_role` key in the Supabase dashboard; update backend/Edge Function secrets; then purge Git history (`git filter-repo`) after explicit confirmation.
4. Publish the rebuilt `dist/` on Netlify (headers ship via `netlify.toml`).

### 16.12 Post-deployment re-verification checklist
- `rpc/lookup_login_email` → 404/function-missing; `rpc/register_identity_check` as anon → authorization error.
- Student `select * from material_chunks` → only approved-material rows.
- Deactivated admin → the six admin-table operations each 403.
- Upload `.html`/`.svg`/`.doc`-with-macros as student → rejected by the storage trigger.
- `curl -I https://<site>` → shows CSP, HSTS, `nosniff`.
- `npm audit` → 0 (already verified).
- AI search returns results for an authenticated query (no 502).

*End of report.*
