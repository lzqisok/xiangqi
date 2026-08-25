import '../env.js'
import { Database } from './database.js'
import { loadDatabaseConfig } from './config.js'
import { assertSchemaReady, migrate, migrationStatus } from './migrations.js'

const command = process.argv[2]
if (!['migrate', 'status', 'check'].includes(command || '')) {
  console.error('Usage: pnpm --filter server db:migrate|db:status|db:check')
  process.exitCode = 2
} else {
  const config = loadDatabaseConfig(process.env, { enabled: true })
  const database = new Database(config)
  try {
    if (command === 'migrate') {
      const versions = await migrate(database)
      console.log(
        versions.length ? `Applied migrations: ${versions.join(', ')}` : 'Schema is current',
      )
    } else if (command === 'status') {
      const status = await migrationStatus(database)
      console.log(
        JSON.stringify({
          currentVersion: status.currentVersion,
          expectedVersion: status.expectedVersion,
          pendingVersions: status.pending.map((item) => item.version),
        }),
      )
    } else {
      await database.ping()
      await assertSchemaReady(database)
      console.log('Database is writable and schema is current')
    }
  } finally {
    await database.close()
  }
}
