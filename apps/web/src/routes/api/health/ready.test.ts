import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Route } from './ready'
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

describe('Readiness Health Endpoint', () => {
  const handler = Route.server?.handlers?.GET

  if (!handler) {
    throw new Error('Readiness handler not exported')
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('returns 200 when both DB and queue are healthy', async () => {
    vi.mocked(client.execute).mockResolvedValue({ rows: [] } as never)
    const mockBoss = {
      getQueueSize: vi.fn().mockResolvedValue(0),
    }
    vi.mocked(getBoss).mockResolvedValue(mockBoss as never)

    const promise = handler({
      request: new Request('http://localhost/api/health/ready'),
    } as never)
    vi.advanceTimersByTime(1000)
    const response = await promise

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ready')
    expect(body.timestamp).toBeDefined()
    expect(body.db_probe_ms).toBeDefined()
    expect(body.queue_probe_ms).toBeDefined()
    expect(body.elapsed_ms).toBeDefined()
  })

  it('returns 503 when database probe fails', async () => {
    vi.mocked(client.execute).mockRejectedValue(new Error('Connection refused'))

    const promise = handler({
      request: new Request('http://localhost/api/health/ready'),
    } as never)
    vi.advanceTimersByTime(1000)
    const response = await promise

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.status).toBe('not_ready')
    expect(body.message).toBe('Service unavailable')
  })

  it('returns 503 when queue probe fails', async () => {
    vi.mocked(client.execute).mockResolvedValue({ rows: [] } as never)
    const mockBoss = {
      getQueueSize: vi.fn().mockRejectedValue(new Error('Queue error')),
    }
    vi.mocked(getBoss).mockResolvedValue(mockBoss as never)

    const promise = handler({
      request: new Request('http://localhost/api/health/ready'),
    } as never)
    vi.advanceTimersByTime(5000)
    const response = await promise

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.status).toBe('not_ready')
  })

  it('returns 503 when database probe timeout fires', async () => {
    vi.mocked(client.execute).mockImplementation(() => new Promise(() => {})) // Never resolves
    const mockBoss = {
      getQueueSize: vi.fn().mockResolvedValue(0),
    }
    vi.mocked(getBoss).mockResolvedValue(mockBoss as never)

    const promise = handler({
      request: new Request('http://localhost/api/health/ready'),
    } as never)
    vi.advanceTimersByTime(5000)
    const response = await promise

    expect(response.status).toBe(503)
  })

  it('does not leak internal error details in response', async () => {
    vi.mocked(client.execute).mockRejectedValue(
      new Error('Connection refused: localhost:5432')
    )

    const promise = handler({
      request: new Request('http://localhost/api/health/ready'),
    } as never)
    vi.advanceTimersByTime(1000)
    const response = await promise

    expect(response.status).toBe(503)
    const body = await response.json()
    const responseBody = JSON.stringify(body)
    expect(responseBody).not.toContain('localhost')
    expect(responseBody).not.toContain('5432')
    expect(responseBody).not.toContain('Connection refused')
  })

  it('logs errors at warn level', async () => {
    vi.mocked(client.execute).mockRejectedValue(new Error('DB error'))

    const promise = handler({
      request: new Request('http://localhost/api/health/ready'),
    } as never)
    vi.advanceTimersByTime(1000)
    await promise

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Readiness probe failed'
    )
  })

  it('returns probe timings in milliseconds', async () => {
    vi.mocked(client.execute).mockResolvedValue({ rows: [] } as never)
    const mockBoss = {
      getQueueSize: vi.fn().mockResolvedValue(0),
    }
    vi.mocked(getBoss).mockResolvedValue(mockBoss as never)

    const promise = handler({
      request: new Request('http://localhost/api/health/ready'),
    } as never)
    vi.advanceTimersByTime(1000)
    const response = await promise
    const body = await response.json()

    expect(typeof body.db_probe_ms).toBe('number')
    expect(typeof body.queue_probe_ms).toBe('number')
    expect(typeof body.elapsed_ms).toBe('number')
    expect(body.elapsed_ms).toBeGreaterThanOrEqual(0)
  })
})
