FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache openssl
WORKDIR /app

# ---- deps: install all dependencies ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/doc-web/package.json apps/doc-web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/monitor-sdk/package.json packages/monitor-sdk/package.json
COPY packages/mini-builder/package.json packages/mini-builder/package.json
COPY packages/mini-agent/package.json packages/mini-agent/package.json
COPY packages/builder-plugin-monitor/package.json packages/builder-plugin-monitor/package.json
RUN pnpm install --frozen-lockfile

# ---- build-shared: build the shared types package ----
FROM deps AS build-shared
COPY packages/shared/ packages/shared/
RUN pnpm --filter @wiseflow/shared run build

# ---- build-server: prisma generate + tsc compile ----
FROM build-shared AS build-server
COPY apps/server/ apps/server/
RUN pnpm --filter @wiseflow/server exec prisma generate
RUN pnpm --filter @wiseflow/server run build

# ---- production: minimal runtime image ----
FROM base AS production
COPY --from=build-server /app/node_modules ./node_modules
COPY --from=build-server /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build-server /app/apps/server/dist ./apps/server/dist
COPY --from=build-server /app/apps/server/prisma ./apps/server/prisma
COPY --from=build-server /app/packages ./packages
COPY --from=build-server /app/package.json ./package.json

# Symlink prisma & tsx so they're findable from any WORKDIR
RUN ln -s /app/apps/server/node_modules/.bin/prisma /usr/local/bin/prisma \
    && ln -s /app/node_modules/.bin/tsx /usr/local/bin/tsx

WORKDIR /app/apps/server
EXPOSE 3001
CMD ["node", "dist/main.js"]
