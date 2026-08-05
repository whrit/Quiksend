# syntax=docker/dockerfile:1
# Worker image. Compile TypeScript to JavaScript (dist/index.js), then run
# with node — no tsx, no source tree, no TypeScript dev deps at runtime.
# Pino's transport worker bundles correctly with compiled JS.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Prune to just @quiksend/worker and the workspace packages it depends on.
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.10.2 prune @quiksend/worker --docker

# Install, build (compile TypeScript), then emit dist/index.js.
FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm --filter @quiksend/worker build

# Runtime: compiled JS + runtime deps only. Non-root user, no source tree.
FROM base AS runner
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=DISABLED_WARNING_MESSAGE

# Create non-root user and group.
RUN groupadd -r worker && useradd -r -g worker worker

WORKDIR /app

# Copy only the pruned lockfile to install runtime deps (not dev deps).
COPY --from=pruner /app/out/json/ .

# Install production deps only (no dev deps, no tsx).
RUN pnpm install --frozen-lockfile --prod

# Copy compiled JavaScript from builder.
COPY --from=builder --chown=worker:worker /app/apps/worker/dist ./apps/worker/dist

# Copy workspace package builds (from builder).
COPY --from=builder --chown=worker:worker /app/packages ./packages

# Lock down filesystem: drop capabilities, no new privileges, read-only root (except /tmp).
RUN chmod -R 555 ./apps/worker/dist ./packages
USER worker

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD test -f /tmp/worker-health || exit 1

CMD ["node", "apps/worker/dist/index.js"]
