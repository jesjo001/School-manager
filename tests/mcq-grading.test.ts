import { describe, expect, it } from 'vitest'
import mongoose, { Schema } from 'mongoose'
import { gradeOne, pendingCount, plainAnswer } from '@/lib/exams'
import type { ExamAttemptDoc, QuestionDoc } from '@/lib/models'

/** Minimal question — only the fields grading reads. */
const question = (over: Partial<QuestionDoc> = {}): QuestionDoc =>
  ({
    type: 'mcq',
    text: 'What is 12 × 8?',
    options: [
      { id: 'q1-a', text: '84' },
      { id: 'q1-b', text: '96' },
    ],
    correctOptionId: 'q1-b',
    acceptedAnswer: '',
    marks: 2,
    order: 1,
    ...over,
  }) as QuestionDoc

describe('MCQ grading', () => {
  it('awards full marks for the keyed option', () => {
    expect(gradeOne(question(), 'q1-b')).toEqual({ isCorrect: true, marksAwarded: 2 })
  })

  it('awards zero for a wrong option', () => {
    expect(gradeOne(question(), 'q1-a')).toEqual({ isCorrect: false, marksAwarded: 0 })
  })

  it('treats a blank or missing response as wrong, not as pending', () => {
    expect(gradeOne(question(), '')).toEqual({ isCorrect: false, marksAwarded: 0 })
    expect(gradeOne(question(), undefined)).toEqual({ isCorrect: false, marksAwarded: 0 })
    expect(gradeOne(question(), '   ')).toEqual({ isCorrect: false, marksAwarded: 0 })
  })

  it('ignores surrounding whitespace in the option id', () => {
    expect(gradeOne(question(), '  q1-b  ')).toEqual({ isCorrect: true, marksAwarded: 2 })
  })

  it('never auto-grades a question with no answer key (hand grading)', () => {
    expect(gradeOne(question({ correctOptionId: null }), 'q1-b')).toEqual({
      isCorrect: null,
      marksAwarded: null,
    })
  })

  it('grades a short answer against the model answer, case/space insensitively', () => {
    const short = question({ type: 'short_answer', correctOptionId: null, acceptedAnswer: 'x = 5' })
    expect(gradeOne(short, 'X = 5')).toEqual({ isCorrect: true, marksAwarded: 2 })
    expect(gradeOne(short, '  x=5  ')).toEqual({ isCorrect: false, marksAwarded: 0 })
  })

  it('leaves a short answer pending when no model answer exists', () => {
    const short = question({ type: 'short_answer', correctOptionId: null, acceptedAnswer: '' })
    expect(gradeOne(short, 'anything')).toEqual({ isCorrect: null, marksAwarded: null })
  })

  it('uses the question marks, not a fixed score', () => {
    expect(gradeOne(question({ marks: 10 }), 'q1-b').marksAwarded).toBe(10)
    expect(gradeOne(question({ marks: 10 }), 'q1-a').marksAwarded).toBe(0)
  })
})

describe('pending answers (grading queue)', () => {
  const attempt = (marks: (number | null)[]) =>
    ({
      answers: marks.map((marksAwarded, index) => ({
        questionId: new mongoose.Types.ObjectId(),
        response: `a${index}`,
        isCorrect: marksAwarded == null ? null : marksAwarded > 0,
        marksAwarded,
        feedback: '',
      })),
    }) as unknown as ExamAttemptDoc

  it('counts only the answers awaiting marks', () => {
    expect(pendingCount(attempt([2, null, 0, null]))).toBe(2)
    expect(pendingCount(attempt([2, 0]))).toBe(0)
    expect(pendingCount(attempt([]))).toBe(0)
  })
})

describe('plainAnswer (subdocument copy)', () => {
  // Regression: `{...subdocument}` spreads mongoose's internals (`_doc`, `$__`)
  // instead of the fields, so the rewritten answer kept its old (ungraded)
  // values when written back. See lib/exams.ts.
  const AnswerSchema = new Schema(
    {
      response: { type: String, default: '' },
      isCorrect: { type: Boolean, default: null },
      marksAwarded: { type: Number, default: null },
    },
    { _id: false },
  )
  const Wrapped =
    mongoose.models.GradeProbe ||
    mongoose.model('GradeProbe', new Schema({ answers: [AnswerSchema] }), 'gradeprobe')

  it('copies field values out of a mongoose subdocument', () => {
    const doc = new Wrapped({ answers: [{ response: 'q1-b', marksAwarded: null }] })
    const sub = doc.answers[0]

    // The bug: a plain spread carries no field values at all.
    const spread = { ...sub } as Record<string, unknown>
    expect(spread.response).toBeUndefined()

    const copied = plainAnswer(sub) as { response: string; marksAwarded: number | null }
    expect(copied.response).toBe('q1-b')
    expect(copied.marksAwarded).toBeNull()
    expect(Object.keys(copied).sort()).toEqual(['isCorrect', 'marksAwarded', 'response'])
  })

  it('leaves plain objects alone', () => {
    const plain = { response: 'x', marksAwarded: 4 }
    expect(plainAnswer(plain)).toEqual(plain)
  })
})
