#!/usr/bin/env bash
set -euo pipefail

cp -n .env.example .env
pnpm install
pnpm prisma:generate
docker compose up postgres redis -d
echo "angel-ai-studio is ready. Run pnpm dev."
