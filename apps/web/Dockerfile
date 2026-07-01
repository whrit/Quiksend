# syntax=docker/dockerfile:1
# Web app image. Multi-stage: prune the monorepo to @quiksend/web, install +
# build the Nitro output, then ship only .output (self-contained — no node_modules).

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Prune to just @quiksend/web and the workspace packages it depends on.
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.10.2 prune @quiksend/web --docker    # web

# Install (cached on the pruned lockfile), then build.
FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @quiksend/web build

# Runtime: Nitro's .output bundles its own deps.
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000
COPY --from=builder /app/apps/web/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
