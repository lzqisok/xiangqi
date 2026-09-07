import { Database } from './database.js'
import { loadDatabaseConfig } from './config.js'
import { verifyRestoredDatabase } from './restoreVerification.js'

const database = new Database(loadDatabaseConfig(process.env, { enabled: true }))
try {
  console.log(JSON.stringify(await verifyRestoredDatabase(database)))
} catch {
  console.error('Restore consistency verification failed')
  process.exitCode = 1
} finally {
  await database.close()
}
