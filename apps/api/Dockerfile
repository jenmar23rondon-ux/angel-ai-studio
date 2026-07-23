FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN corepack enable && pnpm install --filter @angel-ai-studio/api --frozen-lockfile=false
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN pnpm build
EXPOSE 4000
CMD ["pnpm", "start"]
