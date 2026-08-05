import { createFileRoute } from '@tanstack/react-router'

/**
 * Health check endpoint for production monitoring and load balancer verification.
 * Returns HTTP 200 with JSON status on success.
 * Used by docker-compose healthcheck and Kubernetes liveness probes.
 */
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(
          {
            status: 'ok',
            timestamp: new Date().toISOString(),
          },
          { status: 200 }
        )
      },
    },
  },
})
