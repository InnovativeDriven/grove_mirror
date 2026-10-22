#!/bin/bash
set -e  # Exit immediately if a command fails

echo "Building backend..."
cd /mnt/ai-data/ai-services/mike-stack/mike/backend
npm run build

echo "Building frontend..."
cd /mnt/ai-data/ai-services/mike-stack/mike/frontend
npm run build

echo "Restarting services..."
sudo systemctl restart mike-backend mike-frontend

echo "Done."
