# FUW E-Library

Digital library platform for Federal University Wukari — a React + Vite frontend backed by Supabase (PostgreSQL, Auth, Storage, Edge Functions) with an AI study assistant built on Retrieval-Augmented Generation (RAG).

## Quick links

| Portal | URL |
| --- | --- |
| Public library | `/` (home) · `/library` · `/courses` · `/faculties` |
| Student portal | `/login` (username + password) → `/student` |
| Admin portal | `/admin/login` → `/admin` |
| **Super Admin portal** | **`/super/login`** → `/super` (aliases: `/super-admin`, `/superadmin`) |

The Super Admin is the single owner account with full governance: promote/demote admins, assign granular permissions, invite staff, and monitor platform-wide activity.

## Architecture

```
src/
  main.tsx                 App entry, routes (public / student / admin / super admin)
  styles.css               Design system + responsive breakpoints
  pages/
    PublicPages.tsx        Home, Library, Faculties, Courses, Material detail,
                           Login/Register (username + password), Admin login gateway
    StudentPortal.tsx      Student dashboard: uploads, My Uploads (+stats &
                           pagination), AI assistant, saved/recent/downloads/
                           reading history, profile, settings, notifications
    AdminPortal.tsx        Admin dashboard: materials CRUD, approvals, courses,
                           students, AI processing management, settings
    SuperAdminPortal.tsx   Owner governance: admin accounts, permissions,
                           invites, platform stats
  components/              Header, Footer, HeroSection, MaterialCard,
                           CatalogueFilters, DocumentReaderModal, ConfirmDialog
                           /PromptDialog, Toast, ProtectedRoute, Logo
  lib/
    supabase.ts            Supabase client (persistSession + autoRefreshToken)
    AuthContext.tsx        Username/password auth via Supabase Auth, session,
                           roles (student/admin/super_admin), permissions,
                           refreshProfile, changePassword
    rbac.ts                Permission catalogue & checks
    materials.ts           Materials CRUD, storage upload, pagination, counts
    notifications.ts       DB-backed notification centre + realtime subscribe
    ai.ts                  Client wrappers for ai-chat / ai-search / ai-process
    store.ts               Client cache synced from Supabase
  data/catalogue.ts        Faculty → department → level → semester course
                           catalogue with shared/common course expansion

supabase/
  schema.sql               Base tables (profiles, materials, notifications…)
  migrations/
    20260822_upgrade_rbac_ai.sql        RBAC RPCs, RLS policies, invites,
                                        pgvector AI tables, similarity search
    20260822_faculties_levels_format.sql Faculty restructure + level format
                                        normalization ("1000 Level" → "100 Level")
    20260822_username_password_auth.sql Unique profile usernames (+backfill),
                                        username→email lookup RPC, signup checks
  functions/
    ai-chat/               RAG chat (rate-limited, conversation persistence)
    ai-search/             Semantic search over approved materials
    ai-process/            PDF/DOCX/TXT extraction → chunking → embeddings
    _shared/ai.ts          OpenAI-compatible provider helpers (server-side key)
server/, prisma/           Legacy Express/Prisma API foundation (unused by the app)
```

## Roles & access control

- **Student** — browse/search/read materials, upload for approval, track My Uploads status, notifications, profile, AI assistant.
- **Admin** — permission-gated dashboard: manage materials, approve/reject student uploads, run AI processing. Cannot manage other admins.
- **Super Admin** — full control: promote/demote admins, edit details, activate/deactivate, assign granular permissions, invite staff by email, plus everything an admin can do.

Authorization is enforced twice: in React (`ProtectedRoute` with `adminOnly` / `superAdminOnly`) and in PostgreSQL via Row Level Security policies plus `SECURITY DEFINER` RPCs (`promote_to_admin`, `demote_admin`, `set_admin_active`, `update_admin_details`, `update_admin_permissions`, `create_admin_invite`, `approve_material_rpc`, `reject_material_rpc`). Students can never approve their own uploads or modify other users' data.

## Authentication (username + password)

- Students register with **Full Name, Username, Email, Password, Confirm Password**, then complete their academic profile (matric number, faculty, department, level).
- Sign-in uses **Username + Password** everywhere (student, admin, and super admin gateways). The username is resolved to its auth email through the `lookup_login_email` SECURITY DEFINER RPC, then authentication is handled entirely by `supabase.auth.signInWithPassword()` — passwords are hashed and verified by Supabase Auth only, never stored in application tables.
- Usernames are unique (case-insensitive unique index on `profiles.username`) and validated for format; duplicate usernames/emails are rejected pre-signup via the `register_identity_check` RPC.
- Existing email-OTP accounts were preserved: the migration backfills a username for every legacy user from their email local-part (collision-safe suffixes) without touching any other data.
- Sessions persist across refreshes (`persistSession` + `autoRefreshToken`); role-based redirects send students to `/student`, admins to `/admin`, and the super admin to `/super`.

## Key features

- Username + password authentication on top of Supabase Auth with show/hide password toggles, strength validation, friendly error messages, and real in-app password changes (`changePassword`).
- Official FUW faculty structure (14 faculties incl. the College of Health Sciences group) driven by a single centralized catalogue used consistently across every dropdown, upload form, dashboard, and filter.
- Cascading filters everywhere: **Faculty → Department → Level → Semester → Material Type → Course**. Each selection resets its dependents, dependent dropdowns stay disabled until their parent is chosen, levels respect each department's programme duration (100–600 Level), and the course is always the final selection.
- Modern course-directory search bar (icon, clear button, focus states) that filters live and case-insensitively by code/title/department while respecting the cascading filters.
- Student uploads stored in Supabase (database row + Storage file) with pending/approved/rejected workflow, review feedback, statistics, server-side pagination and DB-backed notifications.
- AI study assistant: natural-language Q&A grounded in approved materials with citations, per-material "Ask AI" scoping, summaries/quizzes/revision notes, persisted conversation history, semantic search on the library page.
- Fully responsive UI with fluid typography from desktop down to small phones.

## Run locally

1. Create a Supabase project, then run `supabase/schema.sql` and every migration in `supabase/migrations/` in filename order.
2. Copy `.env.example` to `.env` and fill in your project URL and anon key.
3. `npm install && npm run dev` (frontend on http://localhost:5173).
4. Deploy the edge functions (`supabase/functions/*`) and set their secrets:
   - `AI_API_KEY` (required), optional `AI_BASE_URL`, `AI_MODEL`, `EMBEDDING_MODEL`.
5. Bootstrap the first Super Admin by calling the `promote_first_super_admin` RPC once with your account ID, then sign in at **`/super/login`**.

The legacy Express/Prisma API (`npm run server`) is kept for reference but is not required.

## Database setup — everything to create in Supabase

Run these scripts **in order** in Dashboard → SQL Editor (each is idempotent, safe to re-run):

1. `supabase/schema.sql`
2. `supabase/migrations/20260822_upgrade_rbac_ai.sql`
3. `supabase/migrations/20260822_faculties_levels_format.sql`
4. `supabase/migrations/20260822_username_password_auth.sql` ← **required for username login**

Then configure **Authentication → Providers → Email** (enable *Confirm email* as desired) and **Authentication → Policies** minimum password length (app enforces 8+ chars with a letter and number).

### Extensions

| Extension | Purpose |
| --- | --- |
| `pgcrypto` | `gen_random_uuid()` defaults |
| `vector` (pgvector) | AI embedding storage & similarity search (optional; AI features degrade gracefully without it) |

### Custom enum types

| Type | Values |
| --- | --- |
| `public.app_role` | `student`, `admin`, `super_admin` |
| `public.material_status` | `pending`, `approved`, `rejected` |

### Table `public.profiles` (one row per auth user — created automatically on signup)

| Column | Type | Constraints / Default |
| --- | --- | --- |
| `id` | UUID PK | = `auth.users.id`, ON DELETE CASCADE |
| `full_name` | TEXT | NOT NULL DEFAULT '' |
| `display_name` | TEXT | first name, used across dashboards |
| `email` | TEXT | synced from auth.users by trigger |
| `username` | TEXT | **unique** (case-insensitive index), used for login; backfilled for legacy users from email local-part |
| `matric_number` | TEXT | UNIQUE, set when student completes profile |
| `faculty` | TEXT | official FUW faculty name |
| `department` | TEXT | official FUW department name |
| `level` | TEXT | `"100 Level"` … `"600 Level"` format |
| `bio` | TEXT | optional student bio |
| `avatar_url` | TEXT | optional avatar |
| `role` | `app_role` | NOT NULL DEFAULT `student` — never trusted from frontend |
| `is_active` | BOOLEAN | NOT NULL DEFAULT `true`; deactivated users are signed out |
| `permissions` | TEXT[] | NOT NULL DEFAULT `'{}'`; granular admin permissions |
| `created_by` | UUID | FK → profiles.id, SET NULL (who promoted an admin) |
| `last_login_at` | TIMESTAMPTZ | updated by login trigger |
| `created_at` / `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### Table `public.materials` (library uploads)

| Column | Type | Constraints / Default |
| --- | --- | --- |
| `id` | UUID PK | DEFAULT `gen_random_uuid()` |
| `title` | TEXT | NOT NULL |
| `description` | TEXT | DEFAULT '' |
| `faculty` / `department` / `level` | TEXT | NOT NULL DEFAULT '' |
| `course_code` / `course_title` | TEXT | e.g. `CSC 201` |
| `semester` / `academic_session` | TEXT | e.g. `First Semester`, `2025/2026` |
| `material_type` | TEXT | DEFAULT `'Lecture Note'` |
| `file_url` / `file_name` / `file_size` | TEXT | Storage path/name/size |
| `downloads` / `views` | INTEGER | NOT NULL DEFAULT 0 (bumped via RPCs) |
| `uploaded_by` | UUID | NOT NULL FK → profiles.id CASCADE |
| `status` | `material_status` | NOT NULL DEFAULT `pending` |
| `approved_by` | UUID | FK → profiles.id SET NULL |
| `approved_at` | TIMESTAMPTZ | set on approval/rejection |
| `rejection_reason` | TEXT | feedback shown to uploader |
| `created_at` / `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### Table `public.notifications`

| Column | Type | Constraints / Default |
| --- | --- | --- |
| `id` | UUID PK | DEFAULT `gen_random_uuid()` |
| `user_id` | UUID | NOT NULL FK → profiles.id CASCADE |
| `title` | TEXT | NOT NULL |
| `message` | TEXT | NOT NULL DEFAULT '' |
| `type` | TEXT | NOT NULL DEFAULT `'info'` (`info`/`success`/`warning`) |
| `link` | TEXT | in-app deep link, e.g. `/materials/<id>` |
| `is_read` | BOOLEAN | NOT NULL DEFAULT false |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### Table `public.admin_invites` (Super Admin invites future admins)

| Column | Type | Constraints / Default |
| --- | --- | --- |
| `id` | UUID PK | DEFAULT `gen_random_uuid()` |
| `email` | TEXT | NOT NULL UNIQUE |
| `full_name` | TEXT | DEFAULT '' |
| `invited_by` | UUID | FK → profiles.id SET NULL |
| `accepted` | BOOLEAN | NOT NULL DEFAULT false |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### Table `public.ai_conversations`

| Column | Type | Constraints / Default |
| --- | --- | --- |
| `id` | UUID PK | DEFAULT `gen_random_uuid()` |
| `user_id` | UUID | NOT NULL FK → profiles.id CASCADE |
| `material_id` | UUID | FK → materials.id SET NULL (per-material chats) |
| `title` | TEXT | NOT NULL DEFAULT `'New conversation'` |
| `created_at` / `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### Table `public.ai_messages`

| Column | Type | Constraints / Default |
| --- | --- | --- |
| `id` | UUID PK | DEFAULT `gen_random_uuid()` |
| `conversation_id` | UUID | NOT NULL FK → ai_conversations.id CASCADE |
| `role` | TEXT | NOT NULL, CHECK (`user` \| `assistant`) |
| `content` | TEXT | NOT NULL |
| `citations` | JSONB | cited material chunks |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### Table `public.ai_processing_jobs` (one per material)

| Column | Type | Constraints / Default |
| --- | --- | --- |
| `id` | UUID PK | DEFAULT `gen_random_uuid()` |
| `material_id` | UUID | NOT NULL UNIQUE FK → materials.id CASCADE |
| `status` | TEXT | CHECK (`pending` \| `processing` \| `ready` \| `failed`), DEFAULT `pending` |
| `chunks_created` | INTEGER | NOT NULL DEFAULT 0 |
| `attempts` | INTEGER | NOT NULL DEFAULT 0 |
| `error` | TEXT | failure detail |
| `created_at` / `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### Table `public.material_chunks` (RAG index; written server-side only)

| Column | Type | Constraints / Default |
| --- | --- | --- |
| `id` | UUID PK | DEFAULT `gen_random_uuid()` |
| `material_id` | UUID | NOT NULL FK → materials.id CASCADE |
| `chunk_index` | INTEGER | NOT NULL DEFAULT 0 |
| `content` | TEXT | NOT NULL |
| `page_number` | INTEGER | nullable |
| `course_code` | TEXT | nullable |
| `metadata` | JSONB | DEFAULT '{}' |
| `embedding` | VECTOR(1536) | IVFFlat cosine index when pgvector present |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### Storage

- Bucket **`library-materials`** (public read) — created by the scripts.
- Policies: public `SELECT`, authenticated `INSERT` into the bucket, delete by file owner or admin.

### Triggers (created automatically)

| Trigger | Fires | Effect |
| --- | --- | --- |
| `on_auth_user_created` on `auth.users` | AFTER INSERT | Creates the matching `profiles` row with role `student` and the username chosen at signup |
| `on_profile_invite_check` on `profiles` | BEFORE INSERT | Applies any pending `admin_invites` row (promotes to `admin` with default permissions) |
| `on_auth_login_touch` on `auth.users` | AFTER UPDATE OF last_sign_in_at | Updates `profiles.last_login_at` |
| `set_*_updated_at` on profiles/materials/ai_conversations/ai_processing_jobs | BEFORE UPDATE | Keeps `updated_at` fresh |

### RPC functions

| Function | Callable by | Purpose |
| --- | --- | --- |
| `lookup_login_email(p_username)` | anon, authenticated | Username → login email resolution (returns nothing for unknown/inactive accounts) |
| `register_identity_check(p_username, p_email)` | anon, authenticated | Pre-signup duplicate check → `{username_taken, email_taken}` |
| `get_public_stats()` / `get_library_stats()` | anon, authenticated | Public aggregate counters only |
| `increment_download_count(id)` / `increment_view_count(id)` | anon, authenticated | Safe engagement bumps for approved materials |
| `promote_first_super_admin(email)` | authenticated | **Bootstrap** — promotes your first account to Super Admin (works once) |
| `promote_to_admin(user_id, perms[])` / `demote_admin(user_id)` | Super Admin | Manage administrators |
| `set_admin_active(user_id, active)` / `update_admin_details(user_id, name)` / `update_admin_permissions(user_id, perms[])` | Super Admin | Admin account management |
| `create_admin_invite(email, name)` | Super Admin | Invite a new admin by email |
| `approve_material_rpc(id, note)` / `reject_material_rpc(id, reason)` / `notify_material_deleted(title, uploader)` | permitted admins | Review workflow + automatic student notification |
| `match_material_chunks(embedding, ...)` | authenticated | Semantic similarity search (requires pgvector) |

Helper functions used inside policies: `is_admin()`, `is_super_admin()`, `has_permission(text)`, `my_stored_role()`, `my_is_active()`, `my_permissions()`.

### Row Level Security (enabled on all 8 tables)

- **profiles**: read/update own row; admins read all; only Super Admin may change others' rows or role/is_active/permissions.
- **materials**: everyone reads `approved`; owners see their own (any status); admins see all. Students can only insert their own `pending` uploads and can never self-approve. Deletes limited to own non-approved rows or admins with `delete_any_material`.
- **notifications**: strictly per-user (select/update/delete own).
- **admin_invites**: Super Admin only.
- **ai_conversations / ai_messages**: owner-only via `user_id`.
- **ai_processing_jobs**: admin read-only; **material_chunks**: authenticated read; writes are service-role only.

### Data you must create manually (bootstrap rows)

No seed rows are required — faculties/departments/courses live in `src/data/catalogue.ts`, and materials/uploads are created through the app. Only two manual steps:

1. **Create the Super Admin**: register at `/register` with your owner email, then run once in SQL Editor:
   ```sql
   select public.promote_first_super_admin('your-owner-email@example.com');
   ```
2. **(Optional) Invite additional admins**: sign in at `/super/login` → Admin Accounts → invite by email, or:
   ```sql
   select public.create_admin_invite('staff@fuw.edu.ng', 'Staff Full Name');
   ```

> Passwords are never stored in any of these tables — they live only in Supabase Auth's managed `auth.users` (hashed server-side).

## AI pipeline

Approved material → `ai-process` extracts text (PDF via unpdf, DOCX via mammoth, plain text) → chunks embedded (`text-embedding-3-small`) into `material_chunks` (pgvector, IVFFlat index) → `ai-chat` / `ai-search` retrieve the closest chunks per query/material and answer with citations. Only approved materials are indexed; students' pending uploads never reach the AI. Chat is rate-limited per user (40 messages/hour) and all provider keys stay server-side.
