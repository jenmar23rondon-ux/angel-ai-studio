FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN corepack enable && pnpm install --filter @angel-ai-studio/web --frozen-lockfile=false

FROM deps AS build
COPY apps/web apps/web
RUN pnpm --filter @angel-ai-studio/web build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
