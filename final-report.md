# Final Production-Readiness Report — FUW E-Library (web + mobile)

**Date:** 2026-09-15
**Scope:** Production-readiness audit & fix of the FUW E-Library website (`fuw-e-library`) and mobile app (`fuw-elibrary-mobile`): feature bugs, build warnings, welcome-animation timing, AI service, web/mobile parity, security (RLS), builds.
**Verification method:** Real testing against the live Supabase project (`lgxtiilvpnqgzuarzogb`) with a temporary sandbox user; production `npm run build` and Expo export; REST/RPC-level probes. No interactive browser/mobile E2E was possible from the terminal.

---

## 1. Bugs Fixed (root causes)

### 1.1 Study-planner "Could not add the task" (both web and mobile) — **root cause: missing `user_id`**
- The UI's `createPlannerTask` inserted into `study_planner_tasks` **without `user_id`**. RLS policy `planner_insert_own` requires `auth.uid() = user_id` (`WITH CHECK`), so every insert failed authorization → the user-facing "Could not add the task. Please try again." error. This was a **client bug**, not a DB configuration bug — the schema/policies were correct all along.
- **Fix (web):** `src/lib/planner.ts` `createPlannerTask` now fetches `supabase.auth.getUser()` and inserts `user_id: user.id`.
- **Fix (mobile):** `fuw-elibrary-mobile/src/services/planner.ts` same fix (throws `'Not authenticated'` if no user).
- **Verified:** with a real authenticated JWT, planner INSERT now returns **201**, and SELECT/UPDATE/DELETE of the same row succeed; a second user cannot read/update/delete those rows (RLS own-row scoping confirmed).

### 1.2 Student notes "Could not save note" — **root cause: missing `user_id` (mirror bug)**
- Same missing-`user_id` pattern in `createStudentNote` → `student_notes` insert denied by RLS `notes_insert_own`.
- **Fix (web):** `src/lib/notes.ts`; **Fix (mobile):** `fuw-elibrary-mobile/src/services/notes.ts` (same getUser pattern).
- **Verified:** student_notes INSERT now returns **201**, read-back OK.

### 1.3 AI service failures — **root cause: edge functions not deployed + secrets not set**
- `ai-chat`/`ai-search`/`ai-process` were **not deployed** (404) and `APP_ORIGIN`/AI-key secrets were unset, so the AJAX call failed at the network layer and the UI kept showing a generic "AI service temporarily unavailable".
- **Fix:** deployed all 5 edge functions (`ai-chat`, `ai-search`, `ai-process`, `resolve-login`, `client-info`) to the project (all versions 2, ACTIVE) and set the `APP_ORIGIN` secret to `https://fuw-e-library.netlify.app,http://localhost:5173`.
- **Verified:** `ai-chat` unauthenticated → 401 (correct auth gate); authenticated `ai-chat` → **503 `AI_NOT_CONFIGURED`** with clean message; `client-info` returns device/IP JSON; CORS allows the trusted origin and rejects an evil origin (no `access-control-allow-origin`).
- **Outstanding (blocker for live AI Q&A):** no `AI_API_KEY` exists in the environment. The assistant now returns the honest "not configured yet" message instead of a misleading failure. A real provider key must be added via `supabase secrets set`. See §6 action items.

### 1.4 Vite build warning: circular chunk (vendor ↔ vendor-react)
- The function-form `manualChunks` caused a circular dependency warning. **Fix:** object-form chunks in `vite.config.ts` (`vendor-react`, `vendor-router`, vendor-supabase, vendor-queries, vendor-icons). `npm run build` is now clean — no circular-chunk warning.

### 1.5 Vite build error/warning: mixed dynamic + static imports in `materials.ts`
- Catalogue/store modules were both statically and dynamically imported with conflicting specs. **Fix:** hoisted static imports (`store`, `allDepartments`) and removed three redundant `await import(...)`. Build clean.

### 1.6 Welcome-splash animation timing (web)
- `AppSplash` cold-start (continuation slide) could clip the reveal timings previously. **Fix:** staged reveal (logo 250ms → heading/text 800ms → footer 1450ms), cold-start read 4600ms, returning-user 1800ms, 6500ms safety cap, and `prefers-reduced-motion` forces content visible. Build clean.

---

## 2. Security Tests (all clean)

| Check | Result |
|-------|--------|
| RLS enabled on **every** `public` table (31 tables queried via Management API) | ✅ All `relrowsecurity = true` |
| `study_planner_tasks` policies | ✅ 4 policies, all `auth.uid() = user_id` |
| `student_notes`, `material_bookmarks`, `search_logs`, `security_events` | ✅ Ownership-scoped; `security_events` read = admin or self |
| Server-only tables (`auth_rate_limits`, `storage_usage_logs`) | ✅ Zero policies → denied; anon/authenticated probes → 401/`[]` |
| `material_chunks` write | ✅ `material_chunks_owner_insert` is `TO service_role` (`roles = {service_role}`), `WITH CHECK (true)` is safe — only the `ai-process` service client reaches it; authenticated direct INSERT denied by RLS |
| Admin-guard tables (`active_sessions`, `deletion_requests`, `profile_change_requests`, etc.) | ✅ Admin paths gated by `is_admin()`/`has_permission()` |
| anon INSERT into server-only/materials tables | ✅ 401 (RLS enforced) |
| `resolve-login` (username→email) | ✅ Correct creds → 200 session with user; wrong password → generic 401 `INVALID_CREDENTIALS` (no username/email enumeration) |
| AI error path | ✅ `AI_NOT_CONFIGURED` 503 is surfaced as a friendly "not configured yet" message, no stack/leak |
| CORS | ✅ Trusted origins only |

No new security vulnerability was found during this audit. The one previously-identified operational item remains outstanding by user decision: the leaked `service_role` key in Git history (SEC-01) is **not rotated** — rotation is a manual Supabase console action (see `RUNBOOK_GIT_HISTORY_PURGE.md` / security-report §16.11).

---

## 3. Features Tested

- **Planner:** create → 201, list, update, delete (sandbox user, real DB). ✅
- **Student notes:** create → 201, list, own-row scoping. ✅
- **AI chat/search:** auth gating (401 unauth), provider-not-configured path (503 handled), CORS. ✅
- **resolve-login / client-info edge functions:** correct + incorrect login, device info. ✅
- **RLS cross-user isolation:** user B cannot see/modify user A's planner rows or notes. ✅

## 4. Build Status

| App | Command | Result |
|-----|---------|--------|
| Web (`fuw`) | `npm run build` (tsc + vite) | ✅ Clean — no circular-chunk, no mixed-import warnings |
| Mobile (`fuw-elibrary-mobile`) | `npx tsc --noEmit` | ✅ Clean (strict) |
| Mobile | `npx expo export --platform web` | ✅ Exported successfully |

## 5. Web / Mobile Parity

The planner and notes bugs existed **identically in both apps** and were fixed **identically** (planner.ts / notes.ts in each repo). Remaining parity note: further feature-by-feature comparison of every screen was not automated from the terminal and should be spot-checked in a browser + simulator (see action items).

---

## 6. Action Items (outstanding)

| Priority | Item | Where |
|----------|------|-------|
| High | Add a real provider `AI_API_KEY` (`supabase secrets set AI_API_KEY=...`) so AI chat/search/process actually work | Supabase dashboard / CLI |
| High (manual) | **Rotate the leaked `service_role` key** (SEC-01) — flagged in the earlier security report; rotation requires the Supabase console | `security-report.md` §16.11 |
| Medium | Redeploy the web SPA (publish `dist/`) so the new splash + planner/notes fixes are live on Netlify | Netlify |
| Medium | Browser QA: cold-start splash, planner add/edit on desktop, AI chat message | Local / staging |
| Medium | Simulator QA of mobile planner/notes screens + splash | Expo Go / dev build |
| Low | Run `npx supabase migration list --linked` (only the first migration is recorded as applied even though the live DB schema is correct — apply bookkeeping) | CLI |