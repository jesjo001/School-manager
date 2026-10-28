import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { requireAuth, signSession, type SessionPayload } from '@/lib/auth'
import { School, Student, Tenant, User } from '@/lib/models'
import { scopedFilter, withTenant } from '@/lib/tenant'
import { closeTestDb, connectTestDb, resetTestDb } from './helpers/testdb'

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'campusflow-test-secret'

/**
 * Tenant isolation: the school a request works on comes from the signed session
 * (never from a body, query or header), is re-validated against the database on
 * every call, and every query is pinned to it with `scopedFilter`.
 */
describe('tenant isolation', () => {
  const ids: Record<string, string> = {}
  let tenantA = ''
  let tenantB = ''

  const session = (over: Partial<SessionPayload>): SessionPayload => ({
    sub: '',
    kind: 'staff',
    role: 'proprietor',
    tenantId: tenantA,
    schoolIds: [ids.schoolA],
    activeSchoolId: ids.schoolA,
    name: 'Test User',
    ...over,
  })

  const request = async (payload: SessionPayload | null) => {
    const cookie = payload ? `cf_session=${encodeURIComponent(await signSession(payload))}` : ''
    return new Request('http://localhost/api/students', {
      headers: cookie ? { cookie } : {},
    })
  }

  beforeAll(async () => {
    await connectTestDb()
  })

  beforeEach(async () => {
    await resetTestDb()

    const a = await Tenant.create({ name: 'Alpha School', slug: 'alpha' })
    const b = await Tenant.create({ name: 'Beta School', slug: 'beta' })
    tenantA = String(a._id)
    tenantB = String(b._id)

    const schoolA = await School.create({ tenantId: a._id, name: 'Alpha Primary' })
    const schoolB = await School.create({ tenantId: b._id, name: 'Beta Primary' })
    ids.schoolA = String(schoolA._id)
    ids.schoolB = String(schoolB._id)

    const ownerA = await User.create({
      tenantId: a._id,
      schoolIds: [schoolA._id],
      activeSchoolId: schoolA._id,
      name: 'Owner A',
      email: 'owner-a@example.test',
      passwordHash: 'not-a-real-hash',
      role: 'proprietor',
    })
    const ownerB = await User.create({
      tenantId: b._id,
      schoolIds: [schoolB._id],
      activeSchoolId: schoolB._id,
      name: 'Owner B',
      email: 'owner-b@example.test',
      passwordHash: 'not-a-real-hash',
      role: 'proprietor',
    })
    ids.ownerA = String(ownerA._id)
    ids.ownerB = String(ownerB._id)

    const klass = { className: 'JSS 1', section: 'A' }
    const a1 = await Student.create({
      tenantId: a._id,
      schoolId: schoolA._id,
      admissionNumber: 'ALP-001',
      name: 'Ada Alpha',
      ...klass,
      status: 'active',
    })
    await Student.create({
      tenantId: a._id,
      schoolId: schoolA._id,
      admissionNumber: 'ALP-002',
      name: 'Bola Alpha',
      ...klass,
      status: 'active',
    })
    await Student.create({
      tenantId: b._id,
      schoolId: schoolB._id,
      admissionNumber: 'BET-001',
      name: 'Chika Beta',
      ...klass,
      status: 'active',
    })
    ids.learnerA = String(a1._id)
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('resolves the school from the signed session', async () => {
    const ctx = await withTenant(await request(session({ sub: ids.ownerA })))
    expect(ctx.tenantId).toBe(tenantA)
    expect(ctx.schoolId).toBe(ids.schoolA)
    expect(ctx.role).toBe('proprietor')
    expect(ctx.sessionRefreshed).toBe(false)
  })

  it('pins every query to that tenant and school', async () => {
    const ctx = await withTenant(await request(session({ sub: ids.ownerA })))
    expect(scopedFilter(ctx)).toEqual({ tenantId: tenantA, schoolId: ids.schoolA })

    const rows = await Student.find(scopedFilter(ctx)).sort({ name: 1 })
    expect(rows.map((row) => row.name)).toEqual(['Ada Alpha', 'Bola Alpha'])
  })

  it('never leaks another tenant\u2019s rows into the same query shape', async () => {
    const ctxB = await withTenant(await request(session({ sub: ids.ownerB, tenantId: tenantB, schoolIds: [ids.schoolB], activeSchoolId: ids.schoolB })))
    const rows = await Student.find(scopedFilter(ctxB))
    expect(rows.map((row) => row.name)).toEqual(['Chika Beta'])
    expect(rows.some((row) => String(row.schoolId) === ids.schoolA)).toBe(false)
  })

  it('ignores a school id that was not issued in the session', async () => {
    // Someone edits the cookie payload… they cannot: the token is signed. What
    // they *can* do is carry an old token pointing at a school this user was
    // removed from — the database wins.
    const ctx = await withTenant(
      await request(
        session({
          sub: ids.ownerA,
          activeSchoolId: ids.schoolB,
          schoolIds: [ids.schoolA, ids.schoolB],
        }),
      ),
    )
    expect(ctx.schoolId).toBe(ids.schoolA)
    expect(ctx.sessionRefreshed).toBe(true)
    expect(ctx.session.schoolIds).toEqual([ids.schoolA])
  })

  it('scopes a learner to their own school, whatever the token claims', async () => {
    const ctx = await withTenant(
      await request(
        session({
          sub: ids.learnerA,
          kind: 'student',
          role: 'student',
          activeSchoolId: ids.schoolB,
        }),
      ),
    )
    expect(ctx.schoolId).toBe(ids.schoolA)
    expect(ctx.tenantId).toBe(tenantA)
    expect(ctx.student?.name).toBe('Ada Alpha')
    expect(ctx.sessionRefreshed).toBe(true)
  })

  it('refuses a user who is not attached to any school', async () => {
    const orphan = await User.create({
      tenantId: tenantA,
      schoolIds: [],
      name: 'No School Yet',
      email: 'orphan@example.test',
      passwordHash: 'not-a-real-hash',
      role: 'admin',
    })
    await expect(
      withTenant(await request(session({ sub: String(orphan._id), role: 'admin' }))),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('rejects anonymous and wrong-role callers before any data access', async () => {
    await expect(requireAuth(await request(null), ['proprietor', 'admin'])).rejects.toMatchObject(
      { status: 401 },
    )
    await expect(
      requireAuth(await request(session({ sub: ids.ownerA, role: 'teacher' })), ['proprietor', 'admin']),
    ).rejects.toMatchObject({ status: 403 })
  })
})
