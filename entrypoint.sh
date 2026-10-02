#!/bin/sh

# Default UID/GID if not specified (Unraid's "nobody:users" is 99:100)
PUID=${PUID:-99}
PGID=${PGID:-100}

echo "Configuring runtime user with UID: $PUID, GID: $PGID"

# Run directly as the numeric uid:gid instead of creating a named user/group:
# base-image ids such as 100 (users) or 1000 (node) are already taken, which
# made addgroup/adduser fail and the container exit on start.
mkdir -p /app/data
chown -R "$PUID:$PGID" /app/data

# HOME must be writable for the chosen uid (yt-dlp/ffmpeg may write caches).
export HOME=/app/data

exec su-exec "$PUID:$PGID" node .output/server/index.mjs
