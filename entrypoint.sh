#!/bin/sh

# Default UID/GID if not specified (Unraid's "nobody:users" is 99:100)
PUID=${PUID:-99}
PGID=${PGID:-100}
# The app data folder (database, settings, yt-dlp binary). Overridable only
# so tests can run this script against a temporary folder.
APP_DATA=${YOUKEEP_APP_DATA:-/app/data}
# Tests: print what would run instead of changing owners and starting node.
DRY_RUN=${YOUKEEP_ENTRYPOINT_DRY_RUN:-}

run() {
  if [ -n "$DRY_RUN" ]; then
    echo "$*"
  else
    "$@"
  fi
}

case "$PUID" in ''|*[!0-9]*) echo "PUID must be a number (got '$PUID')." >&2; exit 1 ;; esac
case "$PGID" in ''|*[!0-9]*) echo "PGID must be a number (got '$PGID')." >&2; exit 1 ;; esac

# Running as root gives yt-dlp/ffmpeg (which parse untrusted media) full
# control of the container: refused unless explicitly wanted.
if [ "$PUID" = "0" ] || [ "$PGID" = "0" ]; then
  if [ "$ALLOW_ROOT" != "true" ]; then
    echo "Refusing to run as root (PUID=$PUID, PGID=$PGID). Set PUID/PGID to an unprivileged user, or ALLOW_ROOT=true to run as root anyway." >&2
    exit 1
  fi
  echo "Warning: running as root (ALLOW_ROOT=true)." >&2
fi

echo "Configuring runtime user with UID: $PUID, GID: $PGID"

# Run directly as the numeric uid:gid instead of creating a named user/group:
# base-image ids such as 100 (users) or 1000 (node) are already taken, which
# made addgroup/adduser fail and the container exit on start.
mkdir -p "$APP_DATA"

# Only when the folder's owner differs (a first start, a changed PUID/PGID):
# a recursive chown of a large library on every start is slow. -h changes
# symbolic links themselves, never what they point to.
CURRENT_OWNER=$(ls -nd "$APP_DATA" | awk '{print $3":"$4}')
if [ "$CURRENT_OWNER" != "$PUID:$PGID" ]; then
  run chown -R -h "$PUID:$PGID" "$APP_DATA"
fi

# Permissions of files the app creates (022 -> 644, 000 -> 666).
UMASK_VALUE=${UMASK:-022}
if ! echo "$UMASK_VALUE" | grep -Eq '^[0-7]{3,4}$'; then
  echo "Warning: invalid UMASK '$UMASK_VALUE' (expected 3 or 4 octal digits such as 022); using 022." >&2
  UMASK_VALUE=022
fi
if [ -n "$DRY_RUN" ]; then
  echo "umask $UMASK_VALUE"
else
  umask "$UMASK_VALUE"
fi

# HOME must be writable for the chosen uid (yt-dlp/ffmpeg may write caches).
export HOME="$APP_DATA"

if [ -n "$DRY_RUN" ]; then
  echo "exec su-exec $PUID:$PGID node .output/server/index.mjs"
  exit 0
fi
exec su-exec "$PUID:$PGID" node .output/server/index.mjs
