# syntax=docker/dockerfile:1
# Worker image. No bundling (pino's transport worker doesn't bundle cleanly), so
# we run the TypeScript source with tsx over a pruned install. Env is injected by
# the container at runtime (no .env file).

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS pruner
RUN pnpm add -g turbo@2.10.2
COPY . .
RUN turbo prune @quiksend/worker --docker

FROM base AS runner
ENV NODE_ENV=production
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
CMD ["pnpm", "exec", "tsx", "apps/worker/src/index.ts"]
