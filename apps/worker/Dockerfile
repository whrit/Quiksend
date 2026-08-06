# syntax=docker/dockerfile:1
# Worker image. Bundle TypeScript to JavaScript using esbuild (dist/index.js),
# then run with node — no tsx, no source tree, no TypeScript dev deps at runtime.
# Pino's transport modules are externalized so they can be dynamically loaded.

FROM node:24-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Prune to just @quiksend/worker and the workspace packages it depends on.
FROM base AS pruner
COPY . .
RUN pnpm install --frozen-lockfile && pnpm exec turbo prune @quiksend/worker --docker

# Install, bundle TypeScript -> JavaScript, then emit dist/index.js.
FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @quiksend/worker build

# Runtime: bundled JS + runtime deps only. Non-root user, no source tree.
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

# Copy bundled JavaScript from builder.
COPY --from=builder --chown=worker:worker /app/apps/worker/dist ./apps/worker/dist

# Lock down filesystem: drop capabilities, no new privileges, read-only root (except /tmp).
RUN chmod -R 555 ./apps/worker/dist
USER worker

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const fs = require('fs'); const stat = fs.statSync('/tmp/worker-ready'); const age = (Date.now() - stat.mtimeMs) / 1000; if (age > 90) throw new Error('worker heartbeat stale: ' + age + 's'); console.log('healthy'); process.exit(0);"

CMD ["node", "apps/worker/dist/index.js"]
