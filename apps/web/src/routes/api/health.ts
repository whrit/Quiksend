import { createFileRoute } from '@tanstack/react-router'
import { client } from '@quiksend/db'
import { getBoss } from '@quiksend/queue'
import { logger } from '@quiksend/config'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const path = new URL(request.url).pathname

        // Readiness: 503 if DB or queue fail, bounded probes, no internal detail leaking
        if (path === '/api/health/ready') {
          const startTime = Date.now()
          try {
            const dbProbeStart = Date.now()
            await Promise.race([
              client.execute('SELECT NOW()'),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('DB probe timeout')), 3000)
              ),
            ])
            const dbProbeMs = Date.now() - dbProbeStart

            const queueProbeStart = Date.now()
            await Promise.race([
              getBoss(),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Queue probe timeout')), 2000)
              ),
            ])
            const queueProbeMs = Date.now() - queueProbeStart

            return Response.json(
              {
                status: 'ready',
                timestamp: new Date().toISOString(),
                db_probe_ms: dbProbeMs,
                queue_probe_ms: queueProbeMs,
                elapsed_ms: Date.now() - startTime,
              },
              { status: 200 }
            )
          } catch (err) {
            logger.warn({ err }, 'Readiness probe failed')
            return Response.json(
              { status: 'not_ready', message: 'Service unavailable' },
              { status: 503 }
            )
          }
        }

        // Liveness: 200 regardless of dependencies (covers /live and default)
        return Response.json(
          { status: 'live', timestamp: new Date().toISOString() },
          { status: 200 }
        )
      },
    },
  },
})
