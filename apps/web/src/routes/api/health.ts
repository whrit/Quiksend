import { createFileRoute } from '@tanstack/react-router'
import { client } from '@quiksend/db'
import { getBoss } from '@quiksend/queue'
import { logger } from '@quiksend/config'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const path = url.pathname

        // Liveness: 200 regardless of dependencies, used by container runtimes
        if (path === '/api/health/live') {
          return Response.json(
            {
              status: 'live',
              timestamp: new Date().toISOString(),
            },
            { status: 200 }
          )
        }

        // Readiness: 503 if DB or queue fail, bounded probes, no internal detail leaking
        if (path === '/api/health/ready') {
          const startTime = Date.now()
          const maxProbeTime = 5000 // 5 second total timeout to report 503

          try {
            // DB probe with 3s timeout
            const dbProbeStart = Date.now()
            const dbProbePromise = Promise.race([
              client.execute('SELECT NOW()'),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('DB probe timeout')), 3000)
              ),
            ])
            await dbProbePromise
            const dbProbeTime = Date.now() - dbProbeStart

            // Queue probe with 2s timeout
            const queueProbeStart = Date.now()
            await Promise.race([
              getBoss(),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Queue probe timeout')), 2000)
              ),
            ])
            const queueProbeTime = Date.now() - queueProbeStart

            const elapsedMs = Date.now() - startTime
            return Response.json(
              {
                status: 'ready',
                timestamp: new Date().toISOString(),
                db_probe_ms: dbProbeTime,
                queue_probe_ms: queueProbeTime,
                elapsed_ms: elapsedMs,
              },
              { status: 200 }
            )
          } catch (err) {
            logger.warn({ err }, 'Readiness probe failed')
            const elapsedMs = Date.now() - startTime

            // Bounded response time
            if (elapsedMs > maxProbeTime) {
              return Response.json(
                { status: 'not_ready', message: 'Service probe timeout' },
                { status: 503 }
              )
            }

            return Response.json(
              { status: 'not_ready', message: 'Service unavailable' },
              { status: 503 }
            )
          }
        }

        // Default: liveness for backward compatibility
        return Response.json(
          {
            status: 'live',
            timestamp: new Date().toISOString(),
          },
          { status: 200 }
        )
      },
    },
  },
})
