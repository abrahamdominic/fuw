# FUW E-Library

Digital library platform for Federal University Wukari — a React + Vite frontend backed by Supabase (PostgreSQL, Auth, Storage, Edge Functions) with an AI study assistant built on Retrieval-Augmented Generation (RAG).

## Architecture

```
src/
  main.tsx                 App entry, routes (public / student / admin / super admin)
  styles.css               Design system + responsive breakpoints
  pages/
    PublicPages.tsx        Home, Library, Faculties, Courses, Material detail,
                           Login/Register/OTP, Admin login gateway
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
    AuthContext.tsx        Session, roles (student/admin/super_admin),
                           permissions, refreshProfile
    rbac.ts                Permission catalogue & checks
    materials.ts           Materials CRUD, storage upload, pagination, counts
    notifications.ts       DB-backed notification centre + realtime subscribe
    otpCooldown.ts         Persisted 60s OTP resend cooldown
    ai.ts                  Client wrappers for ai-chat / ai-search / ai-process
    store.ts               Client cache synced from Supabase
  data/catalogue.ts        Faculty → department → level → semester course
                           catalogue with shared/common course expansion

supabase/
  schema.sql               Base tables (profiles, materials, notifications…)
  migrations/
    20260822_upgrade_rbac_ai.sql   RBAC RPCs, RLS policies, invites,
                                   pgvector AI tables, similarity search
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

## Key features

- OTP email authentication with a persisted 60-second resend cooldown and rate-limit-friendly error handling.
- Course catalogue dropdowns that cascade faculty → department → level → semester, including common GST/Maths/Physics courses auto-applied to every applicable department.
- Student uploads stored in Supabase (database row + Storage file) with pending/approved/rejected workflow, review feedback, statistics, server-side pagination and DB-backed notifications.
- AI study assistant: natural-language Q&A grounded in approved materials with citations, per-material "Ask AI" scoping, summaries/quizzes/revision notes, persisted conversation history, semantic search on the library page.
- Fully responsive UI with fluid typography from desktop down to small phones.

## Run locally

1. Create a Supabase project, then run `supabase/schema.sql` and the migration in `supabase/migrations/`.
2. Copy `.env.example` to `.env` and fill in your project URL and anon key.
3. `npm install && npm run dev` (frontend on http://localhost:5173).
4. Deploy the edge functions (`supabase/functions/*`) and set their secrets:
   - `AI_API_KEY` (required), optional `AI_BASE_URL`, `AI_MODEL`, `EMBEDDING_MODEL`.
5. Bootstrap the first Super Admin by calling the `promote_first_super_admin` RPC once with your account ID.

The legacy Express/Prisma API (`npm run server`) is kept for reference but is not required.

## AI pipeline

Approved material → `ai-process` extracts text (PDF via unpdf, DOCX via mammoth, plain text) → chunks embedded (`text-embedding-3-small`) into `material_chunks` (pgvector, IVFFlat index) → `ai-chat` / `ai-search` retrieve the closest chunks per query/material and answer with citations. Only approved materials are indexed; students' pending uploads never reach the AI. Chat is rate-limited per user (40 messages/hour) and all provider keys stay server-side.
