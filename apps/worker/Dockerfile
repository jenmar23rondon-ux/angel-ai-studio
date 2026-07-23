FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/package.json
RUN corepack enable && pnpm install --filter @angel-ai-studio/worker --frozen-lockfile=false
COPY apps/worker apps/worker
WORKDIR /app/apps/worker
RUN pnpm build
CMD ["pnpm", "start"]
