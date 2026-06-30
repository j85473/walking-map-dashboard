#!/bin/bash
echo "Deploying Walking Dashboard to Raspberry Pi (j85473@100.80.154.113)..."

# Build the project first locally? No, build on the Pi is safer for architecture (ARM64)
# We will just sync the source code

rsync -avz --exclude 'node_modules' --exclude '.next' --exclude '.git' --exclude '.env.local' \
  /Users/JosephLamb/AntigravityProjects/Active/Walking\ Map/dashboard/ \
  j85473@100.80.154.113:/home/j85473/walking-dashboard/

echo "Sync complete."
echo "SSH into the Pi, run 'npm install', 'npx prisma generate', 'npm run build', and start via PM2."
