# syntax=docker/dockerfile:1
# Worker image. No bundling (pino's transport worker doesn't bundle cleanly), so
# we run the TypeScript source with tsx over a pruned install. Env is injected by
# the container at runtime (no .env file).

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.10.2 prune @quiksend/web --docker    # web

FROM base AS runner
ENV NODE_ENV=production
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./tsconfig.base.json
CMD ["pnpm", "exec", "tsx", "apps/worker/src/index.ts"]
