import { describe, expect, it } from 'vitest'
import { canStart, effectiveStatus, examDeadline, isExpired } from '@/lib/exams'
import type { ExamDoc } from '@/lib/models'

const at = (iso: string) => new Date(iso)

/** One-hour paper, 2026-06-01 09:00 → 10:00 UTC. */
const exam = (over: Partial<ExamDoc> = {}): ExamDoc =>
  ({
    title: 'Mid-term Mathematics',
    status: 'scheduled',
    startTime: at('2026-06-01T09:00:00.000Z'),
    endTime: at('2026-06-01T10:00:00.000Z'),
    durationMinutes: 60,
    ...over,
  }) as ExamDoc

describe('exam status over its window', () => {
  it('is scheduled before the window opens', () => {
    expect(effectiveStatus(exam(), at('2026-06-01T08:59:59.999Z'))).toBe('scheduled')
  })

  it('is live inside the window', () => {
    expect(effectiveStatus(exam(), at('2026-06-01T09:00:00.000Z'))).toBe('live')
    expect(effectiveStatus(exam(), at('2026-06-01T09:59:59.999Z'))).toBe('live')
  })

  it('closes the moment the window ends', () => {
    expect(effectiveStatus(exam(), at('2026-06-01T10:00:00.000Z'))).toBe('closed')
    expect(effectiveStatus(exam(), at('2026-06-02T10:00:00.000Z'))).toBe('closed')
  })

  it('respects the teacher\u2019s explicit draft and close', () => {
    expect(effectiveStatus(exam({ status: 'draft' }), at('2026-06-01T09:30:00.000Z'))).toBe('draft')
    expect(effectiveStatus(exam({ status: 'closed' }), at('2026-06-01T09:30:00.000Z'))).toBe('closed')
  })

  it('lets a learner start only while it is effectively live', () => {
    expect(canStart(exam(), at('2026-06-01T08:00:00.000Z'))).toBe(false)
    expect(canStart(exam(), at('2026-06-01T09:30:00.000Z'))).toBe(true)
    expect(canStart(exam(), at('2026-06-01T11:00:00.000Z'))).toBe(false)
    expect(canStart(exam({ status: 'draft' }), at('2026-06-01T09:30:00.000Z'))).toBe(false)
    expect(canStart(exam({ status: 'closed' }), at('2026-06-01T09:30:00.000Z'))).toBe(false)
  })
})

describe('deadline of a sitting', () => {
  it('is startedAt + duration while that lands inside the window', () => {
    const deadline = examDeadline(exam({ durationMinutes: 30 }), at('2026-06-01T09:10:00.000Z'))
    expect(deadline.toISOString()).toBe('2026-06-01T09:40:00.000Z')
  })

  it('never runs past the exam end, even with a longer duration', () => {
    const deadline = examDeadline(exam({ durationMinutes: 180 }), at('2026-06-01T09:45:00.000Z'))
    expect(deadline.toISOString()).toBe('2026-06-01T10:00:00.000Z')
  })

  it('expires exactly at the deadline, not a millisecond before', () => {
    const deadline = examDeadline(exam({ durationMinutes: 10 }), at('2026-06-01T09:00:00.000Z'))
    expect(isExpired({ deadlineAt: deadline }, at('2026-06-01T09:09:59.999Z'))).toBe(false)
    expect(isExpired({ deadlineAt: deadline }, at('2026-06-01T09:10:00.000Z'))).toBe(true)
    expect(isExpired({ deadlineAt: deadline }, at('2026-06-01T09:10:00.001Z'))).toBe(true)
  })
})
