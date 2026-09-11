import '../env.js'
import { Database } from '../db/database.js'
import { loadDatabaseConfig } from '../db/config.js'
import { assertSchemaReady } from '../db/migrations.js'
import { MySqlOnlineMatchRepository } from './repository.js'

const [matchId, operator, reason] = process.argv.slice(2)
if (
  !matchId ||
  !operator ||
  !reason ||
  process.argv.length !== 5 ||
  !/^[0-9a-f-]{36}$/i.test(matchId)
) {
  console.error('Usage: pnpm --filter server online:interrupt <matchId> <operator> <reason>')
  process.exitCode = 2
} else {
  const database = new Database(loadDatabaseConfig(process.env, { enabled: true }))
  try {
    await assertSchemaReady(database)
    const result = await new MySqlOnlineMatchRepository(database).interruptMatch(
      matchId,
      'admin_abort',
      operator,
      reason,
    )
    console.log(JSON.stringify({ matchId, interrupted: Boolean(result), ratingChanged: false }))
  } finally {
    await database.close()
  }
}
