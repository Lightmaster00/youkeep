#!/bin/sh

# Default UID/GID if not specified
PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "Configuring runtime user with UID: $PUID, GID: $PGID"

# Create group if it doesn't exist
if ! getent group youkeep >/dev/null 2>&1; then
  addgroup -g "$PGID" youkeep
fi

# Create user if it doesn't exist
if ! getent passwd youkeep >/dev/null 2>&1; then
  adduser -u "$PUID" -G youkeep -h /app -s /bin/sh -D youkeep
fi

# Ensure directory permissions are mapped for user access
mkdir -p /app/data
chown -R youkeep:youkeep /app/data

# Execute the application under the specified user
exec su-exec youkeep node .output/server/index.mjs
