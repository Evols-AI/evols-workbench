#!/bin/sh
set -e

# Substitute ${EVOLS_BACKEND_URL} in librechat.yaml at startup so the container
# picks up the correct backend URL from the env var rather than a baked-in value.
if [ -n "${EVOLS_BACKEND_URL}" ] && [ -f /app/librechat.yaml ]; then
  sed -i "s|\${EVOLS_BACKEND_URL}|${EVOLS_BACKEND_URL}|g" /app/librechat.yaml
fi

exec npm run backend
