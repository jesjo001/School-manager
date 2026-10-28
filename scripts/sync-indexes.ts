/**
 * Creates/verifies every declared index against the running MongoDB.
 *   npm run db:indexes
 */
import { connectDB, disconnectDB } from '../lib/db'
import * as models from '../lib/models'

type MaybeModel = {
  modelName?: string
  syncIndexes?: () => Promise<unknown>
  collection?: { name: string; indexes: () => Promise<unknown[]> }
}

function isModel(value: unknown): value is MaybeModel {
  // Mongoose models are functions (class-like), not plain objects.
  return (
    (typeof value === 'function' || typeof value === 'object') &&
    value !== null &&
    typeof (value as MaybeModel).syncIndexes === 'function' &&
    typeof (value as MaybeModel).modelName === 'string'
  )
}

async function main() {
  await connectDB()
  const entries = Object.entries(models).filter(([, v]) => isModel(v)) as unknown as [
    string,
    MaybeModel,
  ][]

  for (const [, model] of entries) {
    await model.syncIndexes!()
  }

  console.log(`synced indexes for ${entries.length} models:\n`)
  for (const [, model] of entries) {
    const coll = model.collection!
    const indexes = (await coll.indexes()) as { name: string; key: Record<string, number> }[]
    const summary = indexes
      .filter((i) => i.name !== '_id_')
      .map((i) => `    ${Object.entries(i.key).map(([k, v]) => `${k}:${v}`).join(', ')}`)
      .join('\n')
    console.log(`  ${coll.name}`)
    console.log(summary || '    (no secondary indexes)')
  }
}

main()
  .catch((err) => {
    console.error('index sync failed:', err.message)
    process.exitCode = 1
  })
  .finally(() => disconnectDB())
