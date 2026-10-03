# FUW E-Library

FUW E-Library is the digital repository and learning platform of Federal University
Wukari: a public academic library backed by Supabase, with dedicated dashboards for
students, administrators and the Super Admin. This document describes the
application's features, followed by the production-safe database setup guide.

---

## Features

### Public library (no account required)

- **Landing page** — cinematic hero with video background, audio/motion controls,
  live repository statistics, quick search and shortcut links.
- **Library catalogue** — full-text search plus faculty / department / level /
  semester / material-type filters, sorting, removable active-filter chips and a
  mobile filter drawer.
- **Faculties & departments** — browsable directory of all 14 faculties (including
  the College of Health Sciences grouping) with departments and programme durations.
- **Course directory** — searchable index of every seeded course (code, title,
  level, semester) across all departments.
- **Material pages** — rich detail view per material with metadata, uploader info
  and save / download / read-online actions.
- **Interactive reader** — in-browser document reader modal with zoom controls,
  page navigation, reading-progress bar and keyboard-friendly controls.
- **About & contact** pages and a fully responsive branded footer.

### Accounts & authentication

- Student self-registration and login powered by Supabase Auth, with signup
  identity checks (`register_identity_check`) and login email lookup.
- Show/hide password toggles, inline validation feedback and friendly error states.
- Role-aware routing: students land on their dashboard, staff on the admin portal;
  unauthenticated visitors are redirected through protected routes.
- Invited staff automatically become administrators when they sign up with the
  invited email address.

### Student dashboard

- Time-aware greeting header with the student's local time and quick stats.
- **Upload material** with drag-and-drop file dropzone and catalogue-linked
  faculty / department / course / level selects; submissions queue for review.
- **My uploads** — server-side paginated and searchable listing with per-item
  status badges and safe deletion (confirm dialog).
- **AI study assistant** — chat with citations back to library materials, context
  chip for the material being discussed, suggested prompts and markdown answers.
- Saved materials, recently viewed, download history and reading history with
  per-material progress bars.
- Real-time **notification centre** (live Supabase subscription) with unread badge,
  keyword filter, mark-all-read and delete.
- Profile editor (avatar initials, matric, faculty/department/level), password
  change, notification preferences and account danger-zone actions.

### Admin portal (permission-gated)

- Sidebar navigation where every section respects the admin's assigned RBAC
  permission keys.
- **Overview** — eight live metric tiles, monthly submissions/activity chart built
  from real database records, pending-approvals banner and a quick approval queue.
- **Materials & approvals** — tabbed queues (pending / approved / rejected / all)
  with search; approve & publish, reject with a reason prompt, or permanently
  delete (all destructive actions double-confirmed).
- **Direct publishing** — upload materials straight into the library as approved.
- **AI & indexing** management for the ingestion pipeline (permission gated).
- **Students & users**, **faculties**, **departments**, **courses & levels** and
  **categories & sessions** management tables with inline create/edit tooling and
  per-table search.
- **Audit logs** viewer covering every moderation action.
- Settings tab including a read-only maintenance-status card.

### Super Admin portal

- **Governance overview** with platform-wide staff/student/material statistics and
  a quick-reference guide.
- **Administrators** — promote registered students, rename accounts, activate or
  deactivate staff, demote to student (danger-confirmed), and fine-tune each
  admin's permissions through a dedicated checkbox editor modal.
- **Admin invites** — invite staff by email; roles apply automatically at signup,
  with an invite log and filtering.
- **System & maintenance** — persistent maintenance mode stored in Supabase with a
  customisable public message, live status indicator and polished enable/disable
  confirmation dialogs (the Super Admin always retains access).
- **Global dashboard search** across materials, courses, students and staff
  (spotlight-style overlay on desktop, expanding sheet on mobile).

### Platform-wide

- **Maintenance mode gate** — when enabled, students and visitors are redirected
  to a branded maintenance splash showing the custom message, with retry and
  support contact.
- **Toast notifications** for every success/error/info outcome.
- **Security first** — Row Level Security on all 13 tables, SECURITY DEFINER
  helper functions that cannot recurse, permission-scoped RPCs, and storage-bucket
  policies on `library-materials`.
- **Fully responsive UI** — every page adapts from large desktops down to ~320px
  phones: collapsible sidebar drawers with tap-away scrims, horizontally
  scrollable table lanes, reflowing stat/card grids, fluid readable typography,
  touch-sized buttons and modals that fit small screens.

---

## Database Setup Guide

Production-safe SQL migration for the FUW E-Library Supabase database. The three
scripts are designed to run **in order**, against a database that may already
contain users, profiles, materials and catalogue data. Nothing is dropped, no
user is deleted, and every statement is safe to re-run.

---

## 1. What the migration does

### Tables (13)

| Table | Purpose |
|---|---|
| `faculties` | Official FUW faculties, with programme `duration_years` |
| `departments` | Departments grouped under faculties (`faculty_id` FK), with durations |
| `levels` | Study levels — exactly six rows: 100, 200, 300, 400, 500, 600 |
| `courses` | Course catalogue per department (`department_id`, `level_id` FKs), `semester` = *First Semester* / *Second Semester*, `is_general_course` for codes ending in `C` |
| `profiles` | One row per `auth.users` account: full name, username, matric number, faculty/department/level text, `role` (`app_role`), `permissions text[]`, `is_active`, `last_login_at` |
| `materials` | Uploads with normalised FK columns (`faculty_id`, `department_id`, `course_id`, `level_id`) **plus** mirrored display columns kept in sync by trigger; enum-typed `status` and `material_type`; download/view counters |
| `notifications` | Per-user notices generated by review/delete actions |
| `admin_invites` | Pending/accepted admin invitations applied automatically at signup |
| `ai_conversations`, `ai_messages` | AI chat threads and messages |
| `ai_processing_jobs`, `material_chunks` | AI ingestion pipeline (pgvector embeddings, optional) |
| `system_settings` | Persistent key/value settings — maintenance mode lives under key `'maintenance'` |

### Enums (custom types)

- `app_role`: `student`, `admin`, `super_admin`
- `material_status`: `pending`, `approved`, `rejected`
- `material_type`: canonical labels **Test Questions**, **Exam Past Questions**, **Projects**, **Handouts** plus legacy labels (`Test Past Questions`, `Lecture Note`, `Textbook`) so historical rows still fit.

### Relationships

- `profiles.id → auth.users.id` (cascade)
- `departments → faculties`, `courses → departments/levels`
- `materials → faculties/departments/courses/levels/profiles` (uploader + approver)
- `notifications → profiles`, `admin_invites.invited_by → profiles`
- `ai_* → profiles/materials/conversations`

### Roles & security

- Helper functions `is_super_admin()`, `is_admin()`, `has_permission(text)` — SECURITY DEFINER, so policies can never recurse.
- RLS on all 13 tables with explicit SELECT/INSERT/UPDATE/DELETE policies:
  - students see approved materials + their own uploads, manage own profile/notifications;
  - admins additionally read all profiles and review materials per assigned permission keys (`approve_materials`, `reject_materials`, `delete_any_material`, `upload_as_approved`, …);
  - super-admins pass every check (they are never treated as plain students) and exclusively manage catalogue rows, invites, admin accounts and maintenance mode.
- Grants for `anon` (read-only), `authenticated` (full DML, gated by RLS) and `service_role`.
- Storage bucket `library-materials` with public-read + owner/admin write policies.

### Functions & triggers

- Auth sync: new `auth.users` row → matching profile (role defaults to student); login activity updates `last_login_at`; pending invites convert signups to admins automatically.
- RPCs: `promote_first_super_admin`, `promote_to_admin`, `demote_admin`, `set_admin_active`, `update_admin_details`, `update_admin_permissions`, `create_admin_invite`, `approve_material_rpc`, `reject_material_rpc`, `notify_material_deleted`, `lookup_login_email`, `register_identity_check`, stats counters, `get_maintenance_status`, `set_maintenance_mode`, optional `match_material_chunks` (pgvector).
- Catalogue-sync trigger keeps `materials` FK ids and display names consistent in both directions.

### Seed data (script3)

- 14 faculties, 67 departments, 6 levels, 441 course rows.
- Durations honoured: Engineering 5y, Agriculture 5y, Law 5y, Medicine/Clinical Sciences 6y, Medical Laboratory Science 5y, Bachelor of Physiotherapy 5y (Doctor of Physiotherapy track sits under Clinical Sciences at 6y), Anatomy 4y, Physiology 4y.
- Common-course rules: `GST111C` (+`GST112C`) for **every** department at 100 Level; `MTH101C`/`MTH102C`, `PHY101C`/`PHY107C`/`PHY102C`/`PHY108C` for science departments at 100 Level; `GST311C`/`GST312` for everyone at 300 Level.
- Maintenance-mode setting seeded as disabled.

---

## 2. File structure

```text
project-root/
├── script1.sql   # structure: extensions, enums, tables, columns, keys, indexes
├── script2.sql   # security: RLS, policies, grants, functions, triggers, storage
├── script3.sql   # seed rows + final verification
└── README.md     # this guide
```

---

## 3. Prerequisites

1. A Supabase project (PostgreSQL 15+).
2. Access to the **SQL Editor** in the Supabase Dashboard as the project owner (the editor runs statements as `postgres`, which owns both `public` and `auth` objects).
3. Your existing database (this migration targets live projects; it also works on an empty one).
4. No active long-running transactions that lock `public.profiles` or `public.materials` (pause heavy cron jobs if any).
5. Optional but recommended: `pgvector` availability for AI features — the scripts degrade gracefully if it is missing.

---

## 4. Backup

Take a snapshot **before** running anything:

- Dashboard path: **Project Settings → Database → Backups** — note the latest daily backup time, or create a manual backup if your plan supports it.
- CLI alternative:

```bash
# Dump schema + data (requires DATABASE_PASSWORD or a pooled connection string)
pg_dump "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  -Fc -f fuw_backup_before_migration.dump

# Restore point (only if ever needed)
pg_restore -d "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  --clean --if-exists fuw_backup_before_migration.dump
```

Also export CSVs of `profiles`, `materials`, `faculties`, `departments`, `courses` from the Table Editor as a belt-and-braces copy.

---

## 5. Running the migration

Run each file in the Supabase Dashboard → **SQL Editor → New Query**:

1. Paste the entire contents of **`script1.sql`** → **Run**.
2. Confirm it reports `script1 OK - database structure created/aligned ...` (or fix the problems it names).
3. Paste the entire contents of **`script2.sql`** → **Run**.
4. Confirm it reports `script2 OK - RLS (13/13), 28+ functions, triggers, grants, storage ...`.
5. Paste the entire contents of **`script3.sql`** → **Run**.
6. Confirm it reports `SEED COMPLETE` with faculty/department/course counts.

Rules:

- Run the scripts strictly in order `1 → 2 → 3`; each one depends on the previous.
- Verify each script succeeds before starting the next — every script ends with a verification block that raises a single clear exception naming everything wrong if a step failed.
- If a script fails mid-way, the SQL Editor rolls back that whole run; fix the named problem and re-run the same script from the top. It is always safe to re-run.
- Keep the default "auto-commit per statement" behaviour of the SQL Editor; do not wrap the scripts in extra manual transactions.

---

## 6. Verification queries

Run these in the SQL Editor after `script3.sql`. Each query should return the expected result noted beside it.

```sql
-- Tables (expect 13 rows)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Key columns + data types (expect app_role / material_status / material_type)
SELECT table_name, column_name, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (column_name IN ('role','status','material_type'))
ORDER BY table_name, column_name;

-- Enum labels
SELECT t.typname, e.enumlabel
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('app_role','material_status','material_type')
ORDER BY t.typname, e.enumsortorder;
-- Expect: app_role = student/admin/super_admin;
--         material_status = pending/approved/rejected;
--         material_type includes Test Questions, Exam Past Questions,
--         Projects, Handouts (+ legacy labels).

-- Foreign keys on materials (expect >= 6)
SELECT conname, confrelid::regclass AS references_table
FROM pg_constraint
WHERE conrelid = 'public.materials'::regclass AND contype = 'f';

-- Indexes (expect >= 19 core indexes)
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY indexname;

-- RLS enabled everywhere (expect 13 rows)
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
ORDER BY relname;

-- Policies (expect several per table; no duplicates)
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Role distribution (students/admins/super_admins)
SELECT role, COUNT(*) FROM public.profiles GROUP BY role ORDER BY role;

-- Faculties (expect >= 14)
SELECT name, duration_years FROM public.faculties ORDER BY name;

-- Departments (expect >= 60)
SELECT fa.name AS faculty, d.name, d.duration_years
FROM public.departments d JOIN public.faculties fa ON fa.id = d.faculty_id
ORDER BY fa.name, d.name;

-- Levels (expect EXACTLY 6, values 100..600 only)
SELECT name, numeric_level FROM public.levels ORDER BY numeric_level;

-- Courses (expect >= 400)
SELECT COUNT(*) FROM public.courses;

-- GST111C present for every department (expect 0 rows)
SELECT d.name FROM public.departments d
WHERE NOT EXISTS (
  SELECT 1 FROM public.courses c
  WHERE c.department_id = d.id AND upper(c.course_code) = 'GST111C');

-- MTH101C / PHY101C coverage for science students
SELECT upper(course_code), COUNT(*) FROM public.courses
WHERE upper(course_code) IN ('MTH101C','PHY101C')
GROUP BY 1;

-- Semesters (expect only First Semester / Second Semester)
SELECT DISTINCT semester FROM public.courses ORDER BY semester;

-- Material types available to the app (expect the four canonical labels)
SELECT unnest(enum_range(NULL::public.material_type)) AS material_type;

-- Maintenance mode setting
SELECT * FROM public.get_maintenance_status();
```

---

## 7. Authentication verification

1. **Student login**
   - Register a test account at `/register` (username + email + password).
   - Sign out, then log in with the **username** — the app resolves the email via `lookup_login_email` and signs in through Supabase Auth.
   - The user lands on the student dashboard; `profiles.role` = `student`.

2. **Admin login**
   - As super-admin, invite an admin (Super Admin Portal → Admins). Register with the invited email — the signup trigger applies `role = admin` and the standard permission set automatically.
   - Logging in routes to the admin dashboard (`/admin`).

3. **Super-admin login / bootstrap**
   - After registering your own account at `/register`, promote it once:

     ```sql
     SELECT public.promote_first_super_admin('you@example.com');
     ```

   - This only works while zero super-admins exist. Log back in — you should land on `/super` and see the *System & maintenance* tab.

4. **Role assignment checks**

   ```sql
   SELECT email, username, role, is_active, permissions
   FROM public.profiles ORDER BY created_at DESC LIMIT 10;
   ```

5. **Routing sanity** — students never reach `/admin` or `/super`; admins cannot open `/super`; the client derives access purely from `my_stored_role()` / `is_admin()` results served by RLS-backed queries.

---

## 8. Permission verification

Test with the SQL Editor's role switcher or by exercising the UI:

| Check | How |
|---|---|
| Students read appropriate data | Anonymous/incognito visit shows approved materials only (`materials_public_read_policy`). |
| Students can upload | Upload via the student portal → row appears with `status = 'pending'`, `uploaded_by` = self (enforced by `materials_insert_policy`). |
| Students view own uploads | `/student/uploads` lists their pending/approved/rejected submissions. |
| Students cannot edit others | Attempting an UPDATE/DELETE on another user's material returns 0 rows / RLS error. |
| Admins approve/reject | With `approve_materials` permission, use the UI approve button (calls `approve_material_rpc`); uploader receives a notification row. |
| Permission-less admin blocked | Remove `approve_materials` via `update_admin_permissions` → approval RPC raises *"You do not have permission..."*. |
| Super-admin manages admins | Promote/demote/activate/edit permissions all succeed only when called by the super-admin account. |
| Super-admin manages catalogue/maintenance | Editing faculties/courses works only for super-admin; toggling maintenance mode requires `is_super_admin()` (RPC enforced server-side). |
| Unauthorized users blocked | Any anon INSERT/UPDATE/DELETE attempt fails at the grant level (`REVOKE ... FROM anon`). |

Quick SQL probes (run as authenticated user via the app context):

```sql
SELECT public.is_admin(), public.is_super_admin(), public.has_permission('approve_materials');
SELECT * FROM public.get_material_status_counts();  -- admins only see real counts
```

---

## 9. Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `operator does not exist: text = boolean` | A legacy policy/function compared a text column against a boolean expression. | Re-run `script2.sql`; it recreates every policy from scratch with typed helpers. Ensure no custom policy compares `is_active`(boolean) to text values. |
| `operator does not exist: material_status = text` | Comparing the enum column to untyped/legacy text without a cast. | Re-run `script2.sql` — all comparisons now cast explicitly (`status = 'approved'::public.material_status`). If a column is genuinely TEXT, `script1.sql` section 5 converts it to the proper enum first. |
| `cannot alter type of a column used in a policy definition` | Altering a column type while policies reference it. | `script1.sql` drops all stale policies **before** any type alignment and `script2.sql` recreates them afterwards. Never hand-run `ALTER COLUMN TYPE` between the two scripts. |
| `permission denied for table profiles` | Missing table-level GRANTs for `authenticated`/`service_role`. | Re-run `script2.sql` section 10 (grants + default privileges). Verify with `SELECT has_table_privilege('authenticated','public.profiles','SELECT');` |
| `duplicate policy` | Policy already exists under the same name. | Impossible after re-running the scripts: each CREATE is preceded by `DROP POLICY IF EXISTS`. For hand-made policies, drop them first. |
| `duplicate key value violates unique constraint` | Inserting a row whose natural key already exists (e.g., same faculty name, same course code in a department). | Expected protection — seeds use `ON CONFLICT DO UPDATE/NOTHING`, so re-running `script3.sql` is harmless. For manual inserts, use `ON CONFLICT` too or update the existing row instead. |
| `duplicate enum` (`type "app_role" already exists`) | Creating an enum that already exists. | Scripts guard with `pg_type` existence checks. If you wrote your own `CREATE TYPE`, wrap it the same way or skip it. |
| `new row violates row-level security policy` | Writing data the acting role isn't allowed to write (e.g., inserting materials with someone else's `uploaded_by`, or non-super-admin editing catalogue). | Log in as the correct role, keep `uploaded_by = auth.uid()` on inserts, and perform privileged writes via the provided RPCs. |
| `insert or update on table ... violates foreign key constraint` | Referencing a nonexistent id (e.g., `department_id` not in `departments`, or `uploaded_by` not yet registered). | Create/link the parent row first, or let the catalogue-sync trigger resolve names — pass `faculty`/`department`/`level`/`course_code` text instead of ids. |

General rule: every script is idempotent — when in doubt, re-run the failing script from the top after fixing the root cause.

---

## 10. Post-migration checklist

- [ ] `script1.sql` ran with its success notice (no exception).
- [ ] `script2.sql` ran with its success notice (RLS 13/13).
- [ ] `script3.sql` ran with `SEED COMPLETE` (≥14 faculties, ≥60 departments, ≥400 courses).
- [ ] Verification queries in §6 all return expected results.
- [ ] Levels show only 100–600; semesters show only First/Second Semester.
- [ ] `material_type` exposes Test Questions, Exam Past Questions, Projects, Handouts.
- [ ] Storage bucket `library-materials` exists (Storage → Buckets).
- [ ] Owner account registered and promoted via `promote_first_super_admin(...)`.
- [ ] Student signup/login works; username login resolves correctly.
- [ ] Admin invite → registration → admin dashboard flow works.
- [ ] Student upload appears as pending; admin approval flips it to approved and notifies the uploader.
- [ ] Super-admin can toggle maintenance mode (Super Admin Portal → System & maintenance) and the gate reflects it app-wide.
- [ ] Search (⌘K dashboard search) returns results across materials/people/invites/notifications.
- [ ] A fresh anonymous session sees only approved materials and no private profiles.

The database is ready for the FUW E-Library application once every box is ticked.

## Premium access and Paystack operations

Premium entitlements, feature controls, payment transactions, and atomic AI usage
limits are managed by the migration in `supabase/migrations/20261003103937_premium_entitlement_foundation.sql`.
Deploy that migration before deploying the related Edge Functions. The
`paystack-webhook` function must be deployed without gateway JWT verification;
it validates Paystack's HMAC signature itself.

Before enabling automatic payments in **Super Admin → Premium payments**,
configure `PAYSTACK_SECRET_KEY` as a Supabase Edge Function secret. Optionally
set `PAYSTACK_CALLBACK_URL`; otherwise checkout returns to `APP_ORIGIN` at
`/student/subscription?payment=return`. Register
`https://<project-ref>.supabase.co/functions/v1/paystack-webhook` as the
Paystack webhook URL. Do not put provider secrets in Vite variables or client
code. Manual transfers remain separate and require Super Admin approval.
