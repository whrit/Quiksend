import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db, message, enrollment } from '@quiksend/db'
import { logger } from '@quiksend/config'

vi.mock('@quiksend/db')
vi.mock('@quiksend/queue')
vi.mock('@quiksend/config')

import { handleHealthReconcile } from './health-reconcile'

/** Helper: mock a chained db.select().from().where().limit() returning `rows`. */
function mockSelectChain(rows: unknown[]): void {
  vi.mocked(db.select).mockReturnValueOnce({
    from: vi.fn().mockReturnValueOnce({
      where: vi.fn().mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce(rows),
      }),
    }),
  } as never)
}

/** Helper: mock chained select without .limit() (enrollments query) returning `rows`. */
function mockSelectChainNoLimit(rows: unknown[]): void {
  vi.mocked(db.select).mockReturnValueOnce({
    from: vi.fn().mockReturnValueOnce({
      where: vi.fn().mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce(rows),
      }),
    }),
  } as never)
}

describe('Health Reconciliation Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('identifies stale messages created >1 hour ago', async () => {
    const staleMsg = {
      id: 'msg-1',
      enrollmentId: 'enroll-1',
      status: 'pending',
      createdAt: new Date(Date.now() - 61 * 60 * 1000),
    }

    mockSelectChain([staleMsg])
    mockSelectChainNoLimit([])

    await handleHealthReconcile()

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1, states: ['pending'] }),
      'reconciliation-required: stale messages detected'
    )
  })

  it('identifies stale active enrollments with no activity >1 hour', async () => {
    const staleEnroll = {
      id: 'enroll-1',
      status: 'active',
      updatedAt: new Date(Date.now() - 61 * 60 * 1000),
    }

    mockSelectChain([])
    mockSelectChainNoLimit([staleEnroll])

    await handleHealthReconcile()

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      'reconciliation-required: stale active enrollments detected'
    )
  })

  it('does not resend messages, only logs reconciliation-required', async () => {
    const staleMsg = {
      id: 'msg-1',
      enrollmentId: 'enroll-1',
      status: 'pending',
      createdAt: new Date(Date.now() - 61 * 60 * 1000),
    }

    mockSelectChain([staleMsg])
    mockSelectChainNoLimit([])

    await handleHealthReconcile()

    // No db.update or db.insert calls — scan is read-only + log
    expect(vi.mocked(db.update)).not.toHaveBeenCalled()
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled()
  })

  it('bounds scan to 100 records per state type', async () => {
    const limitMock = vi.fn().mockResolvedValueOnce([])

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: limitMock,
        }),
      }),
    } as never)

    mockSelectChainNoLimit([])

    await handleHealthReconcile()

    expect(limitMock).toHaveBeenCalledWith(100)
  })

  it('logs completion with elapsed time and counts', async () => {
    const staleMsg = {
      id: 'msg-1',
      status: 'pending',
      createdAt: new Date(Date.now() - 61 * 60 * 1000),
    }
    const staleEnroll = {
      id: 'enroll-1',
      status: 'active',
      updatedAt: new Date(Date.now() - 61 * 60 * 1000),
    }

    mockSelectChain([staleMsg])
    mockSelectChainNoLimit([staleEnroll])

    await handleHealthReconcile()

    const logCalls = vi.mocked(logger.info).mock.calls
    const completionLog = logCalls.find(call =>
      typeof call[1] === 'string' && call[1].includes('complete')
    )

    expect(completionLog).toBeDefined()
    expect(completionLog?.[0]).toMatchObject({
      elapsedMs: expect.any(Number),
      staleMessagesCount: 1,
      staleEnrollmentsCount: 1,
    })
  })

  it('completes cleanly when no stale records found', async () => {
    mockSelectChain([])
    mockSelectChainNoLimit([])

    await handleHealthReconcile()

    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled()
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.objectContaining({
        staleMessagesCount: 0,
        staleEnrollmentsCount: 0,
      }),
      'Health reconciliation scan complete'
    )
  })
})
