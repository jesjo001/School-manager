import mongoose from 'mongoose'
import './models'

/**
 * MongoDB connection, cached across hot reloads in dev and across invocations
 * in serverless environments. Every request handler goes through `connectDB()`
 * instead of calling `mongoose.connect` directly.
 */
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/campusflow'
const OPTIONS = {
  // No command buffering: fail fast instead of queuing behind a dead socket.
  bufferCommands: false,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 10_000,
  connectTimeoutMS: 10_000,
} satisfies mongoose.ConnectOptions

declare global {
  // eslint-disable-next-line no-var
  var __mongooseConn: Promise<typeof mongoose> | undefined
}

/**
 * Mongoose creates declared indexes in the background. A write that lands
 * before they finish can slip past a unique guarantee (a second learner with
 * the same admission number, two sittings for one learner), so the first
 * request waits for them instead. A build that fails — duplicate rows in a
 * hand-edited database — is reported by model name only and never takes the
 * app down.
 */
async function buildDeclaredIndexes(): Promise<void> {
  await Promise.all(
    Object.values(mongoose.models).map(async (model) => {
      try {
        await model.init()
      } catch (error) {
        const code = (error as { code?: number | string })?.code ?? 'unknown'
        console.warn(`[db] index build failed for ${model.modelName}: ${code}`)
      }
    }),
  )
}

export async function connectDB(): Promise<typeof mongoose> {
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  if (mongoose.connection.readyState === 1) return mongoose

  if (!global.__mongooseConn) {
    mongoose.set('strictQuery', true)
    const promise = mongoose.connect(MONGODB_URI, OPTIONS).then(async (m) => {
      await buildDeclaredIndexes()
      return m
    })
    global.__mongooseConn = promise

    // Clear the cache on failure so the next request can retry instead of
    // permanently caching a rejected promise.
    promise.catch(() => {
      if (global.__mongooseConn === promise) global.__mongooseConn = undefined
    })
  }

  return global.__mongooseConn
}

/** True once a connection is established (used by health checks/tests). */
export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1
}

/** Close the shared connection (tests and long-running scripts only). */
export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect()
  global.__mongooseConn = undefined
}

export { MONGODB_URI }
