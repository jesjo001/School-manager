/**
 * CampusFlow seed data.
 *
 *   npm run seed                  fresh database → full demo tenant + school
 *   npm run seed -- --school <id> top up an existing school (classes, subject,
 *                                 staff and learners only — no fees, attendance
 *                                 or exams, so it never disturbs data that a
 *                                 tenant created themselves)
 *   npm run seed -- --full        build the full demo even when a school exists
 *
 * Every row is looked up before it is written, so the script is safe to re-run
 * after a partial failure. Nothing is ever deleted.
 *
 * Demo sign-in (password for all of them: password123)
 *   ada@greenfield.edu.ng        proprietor  (full demo only)
 *   grace@greenfield.edu.ng      administrator (full demo only)
 *   teacher1@greenfield.edu.ng   teacher
 *   student1@greenfield.edu.ng   learner (also GFA-2401)
 *   student2@greenfield.edu.ng   learner (also GFA-2402)
 *   student3@greenfield.edu.ng   learner (also GFA-2403)
 */
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { connectDB, disconnectDB } from '../lib/db'
import {
  Attendance,
  Exam,
  ExamAttempt,
  Invoice,
  Payment,
  Question,
  School,
  SchoolClass,
  Student,
  Subject,
  TeacherAssignment,
  Tenant,
  User,
} from '../lib/models'

const PASSWORD = 'password123'
const TERM = 'First Term 2026/2027'

type Id = mongoose.Types.ObjectId

const created: string[] = []
const count = (label: string) => created.push(label)

/** Look up a row, create it when missing. Returns the document either way. */
async function ensure(
  Model: mongoose.Model<any>,
  filter: Record<string, unknown>,
  values: Record<string, unknown>,
  label: string,
): Promise<any> {
  const existing = await Model.findOne(filter).exec()
  if (existing) return existing
  const doc = await Model.create({ ...filter, ...values })
  count(label)
  return doc
}

function args() {
  const list = process.argv.slice(2)
  const at = list.indexOf('--school')
  return {
    schoolId: at >= 0 ? list[at + 1] : undefined,
    full: list.includes('--full'),
  }
}

/* ------------------------------------------------------------------ people */

async function ensureStructure(school: any, tenantId: Id) {
  const schoolId = school._id as Id
  const scope = { tenantId, schoolId }

  const jss1 = await ensure(
    SchoolClass,
    { ...scope, name: 'JSS 1' },
    { sections: ['A', 'B'], order: 1 },
    'class:JSS 1',
  )
  const ss1 = await ensure(
    SchoolClass,
    { ...scope, name: 'SS 1' },
    { sections: ['A'], order: 2 },
    'class:SS 1',
  )

  const mathematics = await ensure(
    Subject,
    { ...scope, name: 'Mathematics' },
    { classIds: [jss1._id, ss1._id], code: 'MTH' },
    'subject:Mathematics',
  )

  const hash = await bcrypt.hash(PASSWORD, 10)

  const teacher = await ensure(
    User,
    { tenantId, email: 'teacher1@greenfield.edu.ng' },
    {
      schoolIds: [schoolId],
      activeSchoolId: schoolId,
      name: 'Tunde Bello',
      passwordHash: hash,
      role: 'teacher',
      status: 'active',
      subjectNames: ['Mathematics'],
      classNames: ['JSS 1', 'SS 1'],
    },
    'staff:teacher1@greenfield.edu.ng',
  )

  const learners = [
    {
      admissionNumber: 'GFA-2401',
      name: 'Chidinma Okeke',
      email: 'student1@greenfield.edu.ng',
      classDoc: jss1,
      section: 'A',
      gender: 'Female',
      guardian: { name: 'Mrs Okeke', phone: '08031234567', relation: 'Mother' },
    },
    {
      admissionNumber: 'GFA-2402',
      name: 'Emeka Nwosu',
      email: 'student2@greenfield.edu.ng',
      classDoc: jss1,
      section: 'B',
      gender: 'Male',
      guardian: { name: 'Mr Nwosu', phone: '08039876543', relation: 'Father' },
    },
    {
      admissionNumber: 'GFA-2403',
      name: 'Aisha Bello',
      email: 'student3@greenfield.edu.ng',
      classDoc: ss1,
      section: 'A',
      gender: 'Female',
      guardian: { name: 'Mr Bello', phone: '08031112222', relation: 'Father' },
    },
  ]

  const docs: Record<string, any> = {}
  for (const row of learners) {
    docs[row.admissionNumber] = await ensure(
      Student,
      { ...scope, admissionNumber: row.admissionNumber },
      {
        name: row.name,
        email: row.email,
        className: row.classDoc.name,
        classId: row.classDoc._id,
        section: row.section,
        gender: row.gender,
        guardian: row.guardian,
        status: 'active',
        passwordHash: hash,
      },
      `learner:${row.admissionNumber}`,
    )
  }

  return { jss1, ss1, mathematics, teacher, learners: docs, hash }
}

/* ------------------------------------------------------- demo-only content */

async function ensureFullDemo(school: any, structure: Awaited<ReturnType<typeof ensureStructure>>) {
  const tenantId = school.tenantId as Id
  const schoolId = school._id as Id
  const scope = { tenantId, schoolId }
  const { jss1, ss1, mathematics, teacher, learners, hash } = structure

  // Ownership + administration.
  const owner = await ensure(
    User,
    { tenantId, email: 'ada@greenfield.edu.ng' },
    {
      schoolIds: [schoolId],
      activeSchoolId: schoolId,
      name: 'Ada Nwachukwu',
      passwordHash: hash,
      role: 'proprietor',
      status: 'active',
    },
    'staff:ada@greenfield.edu.ng',
  )
  await ensure(
    User,
    { tenantId, email: 'grace@greenfield.edu.ng' },
    {
      schoolIds: [schoolId],
      activeSchoolId: schoolId,
      name: 'Grace Effiong',
      passwordHash: hash,
      role: 'admin',
      status: 'active',
    },
    'staff:grace@greenfield.edu.ng',
  )
  await Tenant.updateOne({ _id: tenantId }, { $set: { ownerUserId: owner._id } })

  // What the teacher is timetabled to teach.
  for (const klass of [jss1, ss1]) {
    await ensure(
      TeacherAssignment,
      { ...scope, teacherId: teacher._id, subjectId: mathematics._id, classId: klass._id },
      {},
      `assignment:${teacher.email}:${mathematics.name}:${klass.name}`,
    )
  }

  // Today's register for JSS 1 — two present, one late.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  await ensure(
    Attendance,
    { ...scope, classId: jss1._id, date: today },
    {
      records: [
        { studentId: learners['GFA-2401']._id, status: 'present' },
        { studentId: learners['GFA-2402']._id, status: 'late' },
      ],
      markedBy: teacher._id,
      note: 'Morning register',
    },
    'attendance:JSS 1:today',
  )

  // Fees: one settled, one still open, one overdue.
  const dueIn = (days: number) => new Date(Date.now() + days * 86_400_000)
  const invoice = async (
    number: string,
    student: any,
    amount: number,
    status: 'pending' | 'paid' | 'overdue',
    dueDate: Date,
  ) =>
    ensure(
      Invoice,
      { ...scope, number },
      {
        studentId: student._id,
        items: [{ label: `${TERM} tuition`, amount }],
        amount,
        dueDate,
        status,
        term: TERM,
        ...(status === 'paid' ? { paystackRef: `seed_${number}` } : {}),
        createdBy: owner._id,
      },
      `invoice:${number}`,
    )

  await invoice('INV-2401', learners['GFA-2401'], 120_000, 'paid', dueIn(-30))
  await invoice('INV-2402', learners['GFA-2402'], 120_000, 'pending', dueIn(7))
  await invoice('INV-2403', learners['GFA-2403'], 120_000, 'overdue', dueIn(-14))

  const paidInvoice = await Invoice.findOne({ ...scope, number: 'INV-2401' })
  if (paidInvoice) {
    await ensure(
      Payment,
      { ...scope, paystackRef: 'seed_INV-2401' },
      {
        invoiceId: paidInvoice._id,
        studentId: learners['GFA-2401']._id,
        amount: 120_000,
        status: 'paid',
        channel: 'paystack',
        paidAt: dueIn(-29),
        createdBy: owner._id,
      },
      'payment:INV-2401',
    )
  }

  // ---------------------------------------------------------------- exams --
  const question = async (
    exam: any,
    order: number,
    data: {
      type: 'mcq' | 'short_answer'
      text: string
      marks: number
      options?: { id: string; text: string }[]
      correctOptionId?: string
      acceptedAnswer?: string
    },
  ) =>
    ensure(
      Question,
      { ...scope, examId: exam._id, order },
      {
        type: data.type,
        text: data.text,
        options: data.options ?? [],
        correctOptionId: data.correctOptionId ?? null,
        acceptedAnswer: data.acceptedAnswer ?? '',
        marks: data.marks,
      },
      `question:${exam.title}#${order}`,
    )

  const examWindow = (startMs: number, endMs: number, status: string) => ({
    status,
    startTime: new Date(Date.now() + startMs),
    endTime: new Date(Date.now() + endMs),
  })

  // Finished paper with a graded sitting, so Results has something to show.
  const midterm = await ensure(
    Exam,
    { ...scope, title: 'Mid-term Mathematics' },
    {
      subjectId: mathematics._id,
      subjectName: mathematics.name,
      classId: jss1._id,
      className: jss1.name,
      durationMinutes: 45,
      instructions: 'Answer every question. Workings earn marks.',
      createdBy: teacher._id,
      ...examWindow(-3 * 86_400_000, -3 * 86_400_000 + 2 * 3_600_000, 'closed'),
    },
    'exam:Mid-term Mathematics',
  )
  const q1 = await question(midterm, 1, {
    type: 'mcq',
    text: 'What is 12 × 8?',
    marks: 2,
    options: [
      { id: 't1-a', text: '84' },
      { id: 't1-b', text: '96' },
      { id: 't1-c', text: '108' },
    ],
    correctOptionId: 't1-b',
  })
  const q2 = await question(midterm, 2, {
    type: 'mcq',
    text: 'The sum of the angles in a triangle is…',
    marks: 2,
    options: [
      { id: 't2-a', text: '90°' },
      { id: 't2-b', text: '180°' },
      { id: 't2-c', text: '360°' },
    ],
    correctOptionId: 't2-b',
  })
  const q3 = await question(midterm, 3, {
    type: 'short_answer',
    text: 'Solve 3x + 6 = 21 and show your working.',
    marks: 4,
    acceptedAnswer: 'x = 5',
  })

  await ensure(
    ExamAttempt,
    { ...scope, examId: midterm._id, studentId: learners['GFA-2401']._id },
    {
      startedAt: new Date(Date.now() - 3 * 86_400_000),
      deadlineAt: new Date(Date.now() - 3 * 86_400_000 + 45 * 60_000),
      submittedAt: new Date(Date.now() - 3 * 86_400_000 + 30 * 60_000),
      status: 'graded',
      gradedAt: new Date(Date.now() - 3 * 86_400_000 + 35 * 60_000),
      gradedBy: teacher._id,
      answers: [
        { questionId: q1._id, response: 't1-b', isCorrect: true, marksAwarded: 2 },
        { questionId: q2._id, response: 't2-a', isCorrect: false, marksAwarded: 0 },
        {
          questionId: q3._id,
          response: '3x = 15, so x = 5',
          isCorrect: true,
          marksAwarded: 4,
          feedback: 'Clear method — keep the units in the next step.',
        },
      ],
      totalScore: 6,
      maxScore: 8,
      tabSwitchCount: 1,
    },
    'attempt:Mid-term Mathematics:GFA-2401',
  )

  // A paper learners can sit right now, and one on the calendar.
  const live = await ensure(
    Exam,
    { ...scope, title: 'Weekly Quiz — Fractions' },
    {
      subjectId: mathematics._id,
      subjectName: mathematics.name,
      classId: jss1._id,
      className: jss1.name,
      durationMinutes: 15,
      createdBy: teacher._id,
      ...examWindow(-30 * 60_000, 6 * 3_600_000, 'live'),
    },
    'exam:Weekly Quiz — Fractions',
  )
  await question(live, 1, {
    type: 'mcq',
    text: 'Which fraction is equivalent to 0.75?',
    marks: 5,
    options: [
      { id: 'f1-a', text: '1/2' },
      { id: 'f1-b', text: '3/4' },
      { id: 'f1-c', text: '2/3' },
    ],
    correctOptionId: 'f1-b',
  })
  await question(live, 2, {
    type: 'mcq',
    text: 'Simplify 6/9.',
    marks: 5,
    options: [
      { id: 'f2-a', text: '2/3' },
      { id: 'f2-b', text: '3/2' },
      { id: 'f2-c', text: '1/3' },
    ],
    correctOptionId: 'f2-a',
  })

  const scheduled = await ensure(
    Exam,
    { ...scope, title: 'Revision Quiz — Algebra' },
    {
      subjectId: mathematics._id,
      subjectName: mathematics.name,
      classId: jss1._id,
      className: jss1.name,
      durationMinutes: 30,
      createdBy: teacher._id,
      ...examWindow(5 * 86_400_000, 5 * 86_400_000 + 3_600_000, 'scheduled'),
    },
    'exam:Revision Quiz — Algebra',
  )
  await question(scheduled, 1, {
    type: 'mcq',
    text: 'If 2x + 4 = 10, what is x?',
    marks: 5,
    options: [
      { id: 'a1-a', text: '2' },
      { id: 'a1-b', text: '3' },
      { id: 'a1-c', text: '7' },
    ],
    correctOptionId: 'a1-b',
  })
  await question(scheduled, 2, {
    type: 'short_answer',
    text: 'Expand 3(y + 4).',
    marks: 5,
    acceptedAnswer: '3y + 12',
  })
}

/* -------------------------------------------------------------------- main */

async function main() {
  const { schoolId, full } = args()
  await connectDB()

  let school: any = null
  let mode = 'top-up'

  if (schoolId) {
    if (!mongoose.isValidObjectId(schoolId)) throw new Error(`--school needs an id, got “${schoolId}”`)
    school = await School.findById(schoolId)
    if (!school) throw new Error(`No school with id ${schoolId}`)
  } else {
    const schools = await School.find({}).sort({ createdAt: 1 }).limit(2)
    if (schools.length === 0) {
      mode = 'demo'
      const tenant = await ensure(
        Tenant,
        { slug: 'greenfield' },
        {
          name: 'Greenfield Academy',
          status: 'active',
          settings: {
            currency: 'NGN',
            brandColor: '#7479e8',
            logo: '',
            contactEmail: 'hello@greenfield.edu.ng',
            contactPhone: '+234 803 000 0000',
          },
        },
        'tenant:greenfield',
      )
      school = await ensure(
        School,
        { tenantId: tenant._id, slug: 'greenfield' },
        {
          name: 'Greenfield Academy',
          location: 'Ikeja, Lagos',
          address: '14 Oba Akran Avenue, Ikeja, Lagos',
          phone: '+234 803 000 0000',
          brandColor: '#7479e8',
          status: 'active',
        },
        'school:greenfield',
      )
    } else if (schools.length === 1) {
      school = schools[0]
    } else {
      throw new Error(
        'Several schools already exist — re-run with --school <id> (add --full to include the demo fees, attendance and exams).',
      )
    }
  }
  // --full always builds the demo activity (fees, attendance, exams) as well.
  if (full) mode = 'demo'

  const structure = await ensureStructure(school, school.tenantId)
  if (mode === 'demo') await ensureFullDemo(school, structure)

  console.log(
    [
      `seeded ${mode === 'demo' ? 'demo data for' : 'structure for'} ${school.name} (${school._id})`,
      created.length ? `  created ${created.length} new row(s):` : '  everything already present',
      ...created.map((row) => `    + ${row}`),
      `  sign in with password123 — teacher1@greenfield.edu.ng, student1@greenfield.edu.ng`,
    ].join('\n'),
  )
  console.log(
    JSON.stringify({
      schoolId: String(school._id),
      tenantId: String(school.tenantId),
      jss1: String(structure.jss1._id),
      ss1: String(structure.ss1._id),
      subject: String(structure.mathematics._id),
      teacher: String(structure.teacher._id),
      student1: String(structure.learners['GFA-2401']._id),
      student2: String(structure.learners['GFA-2402']._id),
      student3: String(structure.learners['GFA-2403']._id),
      created: created.length,
    }),
  )
}

main()
  .catch((err) => {
    console.error('seed failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => disconnectDB())
