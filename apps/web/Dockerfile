# syntax=docker/dockerfile:1
# Web app image. Multi-stage: prune the monorepo to @quiksend/web, install +
# build the Nitro output, then ship only .output (self-contained — no node_modules,
# no source tree, no package manager).

FROM node:24-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Prune to just @quiksend/web and the workspace packages it depends on.
FROM base AS pruner
COPY . .
RUN pnpm install --frozen-lockfile && pnpm exec turbo prune @quiksend/web --docker

# Install (cached on the pruned lockfile), then build.
FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm --filter @quiksend/web build

# Runtime: Nitro's .output bundles its own deps. Non-root user, no source tree.
FROM node:24-slim AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS=--disable-warning=DISABLED_WARNING_MESSAGE

# Create non-root user and group.
RUN groupadd -r web && useradd -r -g web web

WORKDIR /app

# Copy only the built .output directory with correct ownership.
COPY --from=builder --chown=web:web /app/apps/web/.output ./.output

# Drop all capabilities, no new privileges, read-only root filesystem (except /tmp).
RUN chmod -R 555 ./.output
USER web
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if(r.statusCode!==200)throw new Error(r.statusCode)})"

CMD ["node", ".output/server/index.mjs"]
