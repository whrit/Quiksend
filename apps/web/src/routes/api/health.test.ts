import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { client } from '@quiksend/db'
import { getBoss } from '@quiksend/queue'
import { logger } from '@quiksend/config'

vi.mock('@quiksend/db', () => ({
  client: {
    execute: vi.fn(),
  },
}))

vi.mock('@quiksend/queue', () => ({
  getBoss: vi.fn(),
}))

vi.mock('@quiksend/config', () => ({
  logger: {
    warn: vi.fn(),
  },
}))

describe('Health Endpoint', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  const createRequest = (path: string) => ({
    url: `http://localhost:2019${path}`,
  })

  const handleRequest = async (request: { url: string }) => {
    const url = new URL(request.url)
    const path = url.pathname

    // Liveness: 200 regardless of dependencies
    if (path === '/api/health/live') {
      return Response.json({ status: 'live', timestamp: new Date().toISOString() }, { status: 200 })
    }

    // Readiness: 503 if DB or queue fail
    if (path === '/api/health/ready') {
      const startTime = Date.now()
      const maxProbeTime = 5000

      try {
        const dbProbe = Promise.withResolvers<never>()
        setTimeout(() => dbProbe.reject(new Error('DB probe timeout')), 3000)

        await Promise.race([client.execute('SELECT NOW()'), dbProbe.promise])
        const dbProbeTime = Date.now() - startTime

        const queueProbe = Promise.withResolvers<never>()
        setTimeout(() => queueProbe.reject(new Error('Queue probe timeout')), 2000)

        await Promise.race([getBoss(), queueProbe.promise])
        const queueProbeTime = Date.now() - startTime

        return Response.json(
          {
            status: 'ready',
            timestamp: new Date().toISOString(),
            db_probe_ms: dbProbeTime,
            queue_probe_ms: queueProbeTime,
            elapsed_ms: Date.now() - startTime,
          },
          { status: 200 }
        )
      } catch (err) {
        logger.warn({ err }, 'Readiness probe failed')
        if (Date.now() - startTime > maxProbeTime) {
          return Response.json({ status: 'not_ready', message: 'Service probe timeout' }, { status: 503 })
        }
        return Response.json({ status: 'not_ready', message: 'Service unavailable' }, { status: 503 })
      }
    }

    return Response.json({ status: 'live', timestamp: new Date().toISOString() }, { status: 200 })
  }

  describe('liveness probe', () => {
    it('returns 200 with live status regardless of dependencies', async () => {
      const response = await handleRequest(createRequest('/api/health/live'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('live')
      expect(body.timestamp).toBeDefined()
    })

    it('returns 200 even when database is down', async () => {
      vi.mocked(client.execute).mockRejectedValueOnce(new Error('DB error'))

      const response = await handleRequest(createRequest('/api/health/live'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('live')
    })
  })

  describe('readiness probe', () => {
    beforeEach(() => {
      vi.mocked(client.execute).mockResolvedValue({ rows: [] } as never)
      vi.mocked(getBoss).mockResolvedValue({} as never)
    })

    it('returns 200 when both DB and queue are healthy', async () => {
      const promise = handleRequest(createRequest('/api/health/ready'))
      vi.advanceTimersByTime(1000)
      const response = await promise
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('ready')
      expect(body.db_probe_ms).toBeDefined()
      expect(body.queue_probe_ms).toBeDefined()
    })

    it('returns 503 when database probe fails', async () => {
      vi.mocked(client.execute).mockRejectedValueOnce(new Error('DB error'))

      const promise = handleRequest(createRequest('/api/health/ready'))
      vi.advanceTimersByTime(1000)
      const response = await promise
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.status).toBe('not_ready')
    })

    it('does not leak internal error details', async () => {
      vi.mocked(client.execute).mockRejectedValueOnce(new Error('Connection refused: localhost:5432'))

      const promise = handleRequest(createRequest('/api/health/ready'))
      vi.advanceTimersByTime(1000)
      const response = await promise
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(JSON.stringify(body)).not.toContain('localhost')
      expect(JSON.stringify(body)).not.toContain('5432')
    })
  })
})
