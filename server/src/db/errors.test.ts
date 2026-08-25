import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DatabaseUnavailableError,
  RepositoryForeignKeyConflictError,
  RepositoryUniqueConflictError,
  translateDatabaseError,
} from './errors.js'

test('MySQL error codes map to stable repository errors without leaking details', () => {
  const unique = translateDatabaseError(
    Object.assign(new Error('email@example.com already exists'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    }),
  )
  assert.ok(unique instanceof RepositoryUniqueConflictError)
  assert.equal(unique.message.includes('email@example.com'), false)

  assert.ok(
    translateDatabaseError(
      Object.assign(new Error('fk'), { code: 'ER_NO_REFERENCED_ROW_2' }),
    ) instanceof RepositoryForeignKeyConflictError,
  )
  assert.ok(
    translateDatabaseError(
      Object.assign(new Error('connection'), { code: 'PROTOCOL_CONNECTION_LOST' }),
    ) instanceof DatabaseUnavailableError,
  )
})
