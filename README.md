# FUW E-Library

Full stack foundation for Federal University Wukari's academic digital library.

## Run locally

1. Copy `.env.example` to `.env` and set PostgreSQL and JWT secrets.
2. `npm install`
3. `npm run db:generate && npm run db:migrate && npm run db:seed`
4. Start the API with `npm run server` and the frontend with `npm run dev`.

The frontend runs on `http://localhost:5173`; API defaults to port 4000.

## Included

- Responsive university branded public pages: home, library search/filtering, faculty/department explorer, login and registration.
- Prisma/PostgreSQL model with relationships, indexes, cascade rules, academic sessions, audit log, bookmarks, downloads, views, and rotating token storage.
- Seed data for every supplied FUW faculty, department, and College of Health Sciences department.
- REST API foundation with registration/login/me, catalogue discovery, pagination/filtering, material details, bookmark action, and admin only material creation.
- Server hardening through Helmet, restrictive CORS, JSON size limit, rate limiting, Zod input validation, Argon2 hashing, JWT checks, and role middleware.

## Next production integrations

Add an S3-compatible upload adapter (instead of accepting a `fileUrl`), HTTP-only refresh-token cookies with rotation/revocation, email verification/reset delivery, and background jobs for document scanning/thumbnailing. Keep object files outside PostgreSQL.
