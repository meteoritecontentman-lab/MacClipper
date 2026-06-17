#!/bin/bash
cd "$(dirname "$0")"
if ! lsof -i :4173 > /dev/null 2>&1; then
    echo "Starting MacClipper API server..."
    nohup node backend/server.js > /tmp/macclipper-backend.log 2>&1 &
    sleep 2
else
    echo "MacClipper API already running on port 4173"
fi
echo "Bot secret: $(node backend/server.js --print-bot-secret)"
