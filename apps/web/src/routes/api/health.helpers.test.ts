import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { raceWithTimeout, probeDatabase, probeQueue } from './health.helpers'
import { getBoss } from '@quiksend/queue'

vi.mock('@quiksend/queue', () => ({
  getBoss: vi.fn(),
}))

describe('Health Helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('raceWithTimeout', () => {
    it('returns result when promise resolves before timeout', async () => {
      const promise = Promise.resolve('success')
      const result = raceWithTimeout(promise, 1000, 'timeout')
      vi.advanceTimersByTime(500)
      await expect(result).resolves.toBe('success')
    })

    it('rejects when timeout fires', async () => {
      const promise = new Promise(() => {}) // Never resolves
      const result = raceWithTimeout(promise, 1000, 'timeout message')
      vi.advanceTimersByTime(1000)
      await expect(result).rejects.toThrow('timeout message')
    })

    it('clears timeout on success (no timer leak)', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      const promise = Promise.resolve('success')
      const result = raceWithTimeout(promise, 1000, 'timeout')
      vi.advanceTimersByTime(500)
      await result
      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })

    it('clears timeout on rejection (no timer leak)', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      const promise = Promise.reject(new Error('fail'))
      const result = raceWithTimeout(promise, 1000, 'timeout')
      vi.advanceTimersByTime(500)
      await expect(result).rejects.toThrow('fail')
      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })
  })

  describe('probeDatabase', () => {
    it('returns probe time on successful query', async () => {
      const mockClient = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      }
      const startTime = Date.now()
      const result = probeDatabase(mockClient, 3000)
      vi.advanceTimersByTime(100)
      const probeMs = await result
      expect(probeMs).toBeGreaterThanOrEqual(100)
      expect(mockClient.execute).toHaveBeenCalledWith('SELECT NOW()')
    })

    it('fails when query timeout fires', async () => {
      const mockClient = {
        execute: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      }
      const result = probeDatabase(mockClient, 3000)
      vi.advanceTimersByTime(3000)
      await expect(result).rejects.toThrow('DB probe timeout after 3000ms')
    })

    it('fails when query rejects', async () => {
      const mockClient = {
        execute: vi.fn().mockRejectedValue(new Error('Connection refused')),
      }
      const result = probeDatabase(mockClient, 3000)
      vi.advanceTimersByTime(100)
      await expect(result).rejects.toThrow('Connection refused')
    })
  })

  describe('probeQueue', () => {
    it('returns probe time when queue is healthy', async () => {
      const mockBoss = {
        getQueueSize: vi.fn().mockResolvedValue(0),
      }
      vi.mocked(getBoss).mockResolvedValue(mockBoss as never)

      const result = probeQueue(2000)
      vi.advanceTimersByTime(100)
      const probeMs = await result
      expect(probeMs).toBeGreaterThanOrEqual(100)
      expect(mockBoss.getQueueSize).toHaveBeenCalledWith('health.reconcile')
    })

    it('fails when getQueueSize timeout fires', async () => {
      const mockBoss = {
        getQueueSize: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      }
      vi.mocked(getBoss).mockResolvedValue(mockBoss as never)

      const result = probeQueue(2000)
      vi.advanceTimersByTime(2000)
      await expect(result).rejects.toThrow('Queue probe timeout after 2000ms')
    })

    it('fails when getBoss throws', async () => {
      vi.mocked(getBoss).mockRejectedValue(new Error('Boss initialization failed'))

      const result = probeQueue(2000)
      vi.advanceTimersByTime(100)
      await expect(result).rejects.toThrow('Boss initialization failed')
    })
  })
})
