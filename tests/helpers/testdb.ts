import mongoose from 'mongoose'

/**
 * Tests get their own database so a developer's `campusflow` data (and the
 * e2e gate's) is never touched. Override with `TEST_MONGODB_URI`; the name
 * must look like a test database or the helper refuses to run.
 *
 * Requires the same local MongoDB the app uses.
 */
export const TEST_URI =
  process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/campusflow-test'

const databaseName = () => TEST_URI.split('/').pop()?.split('?')[0] ?? ''

export async function connectTestDb(): Promise<void> {
  const name = databaseName()
  if (!name || (!name.includes('test') && !name.endsWith('_test'))) {
    throw new Error(`Refusing to run tests against "${name}" — use a *-test database`)
  }
  if (mongoose.connection.readyState === 0) await mongoose.connect(TEST_URI)
  if (mongoose.connection.db?.databaseName !== name) {
    throw new Error(`Connected to ${mongoose.connection.db?.databaseName}, expected ${name}`)
  }
}

/** Drop every document — run before each test for a clean slate. */
export async function resetTestDb(): Promise<void> {
  const db = mongoose.connection.db
  if (!db) return
  for (const { name } of await db.listCollections().toArray()) {
    await db.collection(name).deleteMany({})
  }
}

/** Drop the whole test database and disconnect. */
export async function closeTestDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) await mongoose.connection.db?.dropDatabase()
  await mongoose.disconnect()
}
