#!/bin/bash
# Start the Electron app on the virtual display
# This script is run by supervisord after Xvfb is ready.

set -e

# Wait for the virtual display to be ready
sleep 2

echo "[GUI] Starting Electron on display $DISPLAY …"

# Run Electron with required flags for containerized environments
exec npx electron . \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --external-test \
    --external-port 8788 \
    "$@"
