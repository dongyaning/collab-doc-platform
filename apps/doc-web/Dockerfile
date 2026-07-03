# ---- builder: build the Vite frontend ----
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

ARG VITE_COLLAB_WS_URL
ENV VITE_COLLAB_WS_URL=${VITE_COLLAB_WS_URL}

# Install deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/doc-web/package.json apps/doc-web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/monitor-sdk/package.json packages/monitor-sdk/package.json
COPY packages/mini-builder/package.json packages/mini-builder/package.json
COPY packages/mini-agent/package.json packages/mini-agent/package.json
COPY packages/builder-plugin-monitor/package.json packages/builder-plugin-monitor/package.json
RUN pnpm install --frozen-lockfile

# Build shared package (required for type-checking during vite build)
COPY packages/shared/ packages/shared/
RUN pnpm --filter @wiseflow/shared run build

# Build frontend
COPY apps/doc-web/ apps/doc-web/
RUN pnpm --filter @wiseflow/doc-web run build

# ---- nginx: serve static files + proxy API/WS ----
FROM nginx:alpine
COPY apps/doc-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/doc-web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
