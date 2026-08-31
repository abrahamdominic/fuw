# FUW E-Library — Purge leaked `service_role` key from Git history (SEC-01)

> **Read this entire file before running anything.** These commands rewrite
> every commit SHA and are **destructive and irreversible** for pushed history.
> They must be run on a **fresh clone** and coordinated with all collaborators.
> Confirm the Supabase `service_role` key was **rotated first** (dashboard) — a
> purge of history is not itself a remediation; it only removes the key from the
> repo so it cannot be recovered from there.

---

## 1. Why

The live Supabase `service_role` key (a base64url JWT that **bypasses RLS**) was
committed to `.env.example` and still lives in git history in these commits:

- `40679a1` (introduced the key)
- `7337066` (deleted the file, removing it from tracking but **not** history)

The current `HEAD` tree is clean (verified: no live key in tracked files; the
only `eyJhbGci` strings are the guard regex in `.gitleaks.toml` /
`scripts/secret-guard.sh`). Purging history removes the lingering copies.

---

## 2. Prerequisites

- The `service_role` key **must already be rotated** in the Supabase Dashboard.
- Install `git-filter-repo`:

```bash
# macOS (Homebrew) — much faster than pip and uses the installed git libgit2
brew install git-filter-repo

# OR via pip (any OS)
python3 -m pip install --user git-filter-repo
```

Verify:

```bash
git filter-repo --version   # e.g. "git-filter-repo, version 2.38.0"
```

- You need **write access to the remote** and coordinate with any other clone.

---

## 3. Backup (do this first)

`git-filter-repo` automatically writes a backup run of the original refs to
`.git/filter-repo/` inside the clone, but take an **independent** backup too:

```bash
# Fresh clone (never run on your working repo with un-pushed work)
git clone --mirror <REMOTE_URL> fuw-backup
cd fuw-backup
git bundle create ../fuw-pre-purge.bundle --all
cd ..
# Keep fuw-backup/ and fuw-pre-purge.bundle somewhere safe (not in the repo).
```

---

## 4. Purge the key from all history (fresh clone)

```bash
# 1) Fresh clone of the repo on a clean machine/branch
git clone <REMOTE_URL> fuw-purge
cd fuw-purge

# 2) Remove the secret VALUE from every commit in history.
#    Replace <REDACTED> is NOT enough here — the JWT is a known, rotated
#    secret, so we drop the committed key entirely from every blob.
#    The blob-callback receives a Blob object `b`; its raw bytes are `b.data`
#    (bytes). Set `b.data` to a new value to rewrite the blob.
git filter-repo --blob-callback '
import re
pat_jwt   = re.compile(rb"eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}")
pat_secr  = re.compile(rb"sb_secret_[A-Za-z0-9]+")
new = pat_jwt.sub(b"<REDACTED>", b.data)
new = pat_secr.sub(b"<REDACTED>", new)
if new != b.data:
    b.data = new
'

# 3) Expire all reflogs and aggressively prune so the blobs are unreachable.
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### Simpler alternative — remove the secret-bearing *file* from history

If the only leak is the `.env.example` file and you'd rather remove it outright
(not redact), this drops the file's content from every commit it ever appeared
in:

```bash
git filter-repo --path .env.example --invert-paths
```

Use **either** step 2 (redact values) **or** the file-removal approach — not
both. The redaction approach is preferred when the same secret could also exist
inside other historical files (e.g. a past `server/.env`).

---

## 5. Verify the key is genuinely gone

After filtering, the JWT value must not appear anywhere in the rewritten
history (search *all* commits, including the old ones):

```bash
# Search every blob in history for the JWT-shape (single quotes prevent shell
# expansion)
git rev-list --objects --all | while read -r oid _; do
  git cat-file -p "$oid" 2>/dev/null;
done | grep -E 'eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}' && \
  echo "!!! STILL PRESENT !!!" || echo "OK: no JWT-shaped token in history"

# Confirm the old commits no longer contain the file
git log --all --oneline -S 'eyJhbGciOiJIUzI1Ni' -- . || echo "OK: no source-blob matches"
```

> If `grep` outputs nothing and the `|| echo` prints, the purge worked.

Also confirm HEAD is still clean and the app still builds locally from an
**untouched** `.env` (do not re-add any real secret to tracked files):

```bash
git status --short
npx tsc -b --force && npx vite build
```

---

## 6. Force-push the rewritten history & re-clone

Rewriting history changes every SHA; a normal `git push` will be rejected. You
must use a force-push that replaces the remote branch (protected-branch rules
may require temporarily disabling the protection or using a merge request).

```bash
git remote add origin <REMOTE_URL>          # if not already set
git push --force --force-with-lease origin main
# and any other long-lived branches that existed in history
```

**After pushing**, every collaborator must re-clone (their old clones still
contain the leaked key in their local history):

```bash
# On each collaborator machine — DELETE the old clone and re-clone fresh:
rm -rf fuw-e-library
git clone <REMOTE_URL> fuw-e-library
```

Never `git pull` the rewritten history into an old clone — it will fight the
rewrite. A fresh clone is the only safe path.

---

## 7. Post-purge hygiene

1. **Keep the backup bundle** (`fuw-pre-purge.bundle`) until you are certain the
   rewrite is correct and all collaborators have re-cloned — then delete it.
2. Consider enabling **secret scanning / push protection** on the remote (GitHub:
   Settings → Code security → Secret scanning & push protection; GitLab: push
   rules) so a future accidental commit of `eyJ...` or `sk-` is blocked.
3. The local **pre-commit hook** (`scripts/secret-guard.sh`) and `.gitleaks.toml`
   already block the JWT shape from being (re)committed; keep them in place.
4. **Do not** commit `.env` or any file containing a real key. `.env` remains
   gitignored.

---

## Rollback / if something goes wrong

Restore from the backup bundle if the rewrite produced a broken repo:

```bash
# From the backup mirror clone
cd fuw-backup
git fetch --all
# Re-push the original refs
git push --force origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'
```

Coordinate the rollback push like the rewrite push (it is another history
rewrite).
