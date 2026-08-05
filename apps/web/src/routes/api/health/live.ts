import { createFileRoute } from '@tanstack/react-router'

/**
 * Liveness probe: 200 always, regardless of dependency health.
 * Container orchestrators use this to detect if the process is alive.
 * Failure to respond or bad status triggers pod restart.
 *
 * This endpoint is dependency-free: no DB, queue, external service checks.
 */
export const Route = createFileRoute('/api/health/live')({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(
          { status: 'live', timestamp: new Date().toISOString() },
          { status: 200 }
        )
      },
    },
  },
})
