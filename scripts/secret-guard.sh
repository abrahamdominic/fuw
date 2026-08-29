#!/bin/sh
# FUW E-Library pre-commit secret guard.
# Scans staged files for Supabase service-role keys and AI provider keys to
# prevent re-introducing the SEC-01 leak. Requires no external dependencies.
set -e

# Pattern: Supabase service_role JWTs or sb_secret_* values.
SERVICE_REGEX='(sb_secret_[a-zA-Z0-9]+|eyJhbGciOiJIUzI1NiJ9\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,})'
AI_REGEX='(sk-[a-zA-Z0-9]{20,})'

FOUND=0
for f in $(git diff --cached --name-only --diff-filter=ACM); do
  case "$f" in
    *.lock|*.min.js|*.map) continue ;;
  esac
  if [ -f "$f" ]; then
    if grep -nE "$SERVICE_REGEX" "$f" | grep -vE 'yo|your_|example|<your' >/dev/null 2>&1; then
      echo "SECRET GUARD: possible Supabase service_role key staged in '$f'." >&2
      FOUND=1
    fi
    if grep -nE "$AI_REGEX" "$f" | grep -vE 'your_key|example|<your' >/dev/null 2>&1; then
      echo "SECRET GUARD: possible AI provider key staged in '$f'." >&2
      FOUND=1
    fi
  fi
done

if [ "$FOUND" -ne 0 ]; then
  echo "Commit blocked: rotate any leaked keys and remove them from the staged files." >&2
  exit 1
fi
exit 0