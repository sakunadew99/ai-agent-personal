#!/bin/sh
# Start the API: apply database migrations, then run the given command (uvicorn ...).
#
# Rollback safety: if the database is NEWER than this code (for example after rolling back a deploy on Render),
# `alembic upgrade head` fails with "Can't locate revision". Every migration in this project is expand-only
# (new tables/columns, nothing dropped or renamed), so older code works on a newer schema. Instead of a crash loop,
# log a loud warning and start. Any other migration error still stops the start.
set -u

if output=$(alembic upgrade head 2>&1); then
  printf '%s\n' "$output"
else
  printf '%s\n' "$output"
  if printf '%s' "$output" | grep -q "Can't locate revision"; then
    echo "WARNING: the database schema is newer than this code (a rollback?). Starting anyway because all migrations are expand-only."
    echo "WARNING: deploy the latest code soon so new features and migrations line up again."
  else
    echo "ERROR: database migration failed; not starting." >&2
    exit 1
  fi
fi

exec "$@"
