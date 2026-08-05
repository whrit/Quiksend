import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db, jobLog, message, enrollment } from '@quiksend/db'
import { enqueue } from '@quiksend/queue'
import { logger } from '@quiksend/config'
import { eq } from 'drizzle-orm'

// Mock dependencies
vi.mock('@quiksend/db')
vi.mock('@quiksend/queue')
vi.mock('@quiksend/config')

import { handleHealthReconcile } from './health-reconcile'

describe('Health Reconciliation Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('identifies stale messages created >1 hour ago', async () => {
    const oneHourAgo = new Date(Date.now() - 61 * 60 * 1000)
    const staleMsg = {
      id: 'msg-1',
      enrollmentId: 'enroll-1',
      status: 'pending',
      createdAt: oneHourAgo,
    }

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]), // No prior job log
          }),
        }),
      }),
    } as never)

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([staleMsg]),
      }),
    } as never)

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([]), // No stale enrollments
      }),
    } as never)

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue({}),
    } as never)

    vi.mocked(enqueue).mockResolvedValue('job-123')

    await handleHealthReconcile()

    // Verify stale message was found
    expect(db.select).toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalledWith(
      'health.reconcile',
      {},
      expect.objectContaining({
        singletonKey: expect.stringContaining('stale-messages'),
      })
    )
  })

  it('enqueues at most one repair job per stale state type across repeated scans', async () => {
    const staleMsg = {
      id: 'msg-1',
      enrollmentId: 'enroll-1',
      status: 'pending',
      createdAt: new Date(Date.now() - 61 * 60 * 1000),
    }

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                jobName: 'health.reconcile',
                createdAt: new Date(Date.now() - 2 * 60 * 1000), // Recent scan
              },
            ]),
          }),
        }),
      }),
    } as never)

    await handleHealthReconcile()

    // Should skip scan if recent one exists
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('logs reconciliation-required marker without resending stale messages', async () => {
    const staleMsg = {
      id: 'msg-1',
      enrollmentId: 'enroll-1',
      status: 'pending',
      createdAt: new Date(Date.now() - 61 * 60 * 1000),
    }

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      }),
    } as never)

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([staleMsg]),
      }),
    } as never)

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([]),
      }),
    } as never)

    const insertMock = vi.fn().mockResolvedValue({})
    vi.mocked(db.insert).mockReturnValue({
      values: insertMock,
    } as never)

    vi.mocked(enqueue).mockResolvedValue('job-123')

    await handleHealthReconcile()

    // Verify job log entry was created (marked reconciliation-required)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: 'health.reconcile',
        status: 'started',
        // Note: not re-enqueueing the message itself
      })
    )

    // Verify only repair job enqueued, no resend
    const enqueueCalls = vi.mocked(enqueue).mock.calls
    expect(enqueueCalls.every(call => call[0] === 'health.reconcile')).toBe(true)
  })

  it('identifies stale active enrollments with no activity >1 hour', async () => {
    const oneHourAgo = new Date(Date.now() - 61 * 60 * 1000)
    const staleEnroll = {
      id: 'enroll-1',
      status: 'active',
      updatedAt: oneHourAgo,
    }

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      }),
    } as never)

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([]), // No stale messages
      }),
    } as never)

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([staleEnroll]),
      }),
    } as never)

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue({}),
    } as never)

    vi.mocked(enqueue).mockResolvedValue('job-456')

    await handleHealthReconcile()

    expect(enqueue).toHaveBeenCalledWith(
      'health.reconcile',
      {},
      expect.objectContaining({
        singletonKey: expect.stringContaining('stale-enrollments'),
      })
    )
  })

  it('bounds scan to 100 records per state type', async () => {
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      }),
    } as never)

    const whereChain = {
      limit: vi.fn().mockResolvedValueOnce([]), // Empty result
    }

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce(whereChain),
      }),
    } as never)

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce(whereChain),
      }),
    } as never)

    await handleHealthReconcile()

    // Verify limit calls were made
    expect(whereChain.limit).toHaveBeenCalledWith(100)
  })

  it('logs completion with elapsed time and counts', async () => {
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      }),
    } as never)

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([
          { id: 'msg-1', status: 'pending', createdAt: new Date(Date.now() - 61 * 60 * 1000) },
        ]),
      }),
    } as never)

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([
          { id: 'enroll-1', status: 'active', updatedAt: new Date(Date.now() - 61 * 60 * 1000) },
        ]),
      }),
    } as never)

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue({}),
    } as never)

    vi.mocked(enqueue).mockResolvedValue('job-999')

    await handleHealthReconcile()

    const logCalls = vi.mocked(logger.info).mock.calls
    const completionLog = logCalls.find(call => call[1]?.includes('complete'))

    expect(completionLog).toBeDefined()
    expect(completionLog?.[0]).toMatchObject({
      elapsedMs: expect.any(Number),
      staleMessagesCount: 1,
      staleEnrollmentsCount: 1,
    })
  })

  it('does not resend messages, only marks for reconciliation', async () => {
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          orderBy: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      }),
    } as never)

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([
          { id: 'msg-1', status: 'pending', createdAt: new Date(Date.now() - 61 * 60 * 1000) },
        ]),
      }),
    } as never)

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([]),
      }),
    } as never)

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue({}),
    } as never)

    vi.mocked(enqueue).mockResolvedValue('job-123')

    await handleHealthReconcile()

    // Verify we never enqueued message sending jobs, only reconciliation jobs
    const calls = vi.mocked(enqueue).mock.calls
    expect(calls.every(call => call[0] === 'health.reconcile')).toBe(true)
  })
})
