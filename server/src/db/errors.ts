export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = new.target.name
  }
}

export class DatabaseUnavailableError extends RepositoryError {
  constructor(options?: ErrorOptions) {
    super('Database unavailable', 'database_unavailable', options)
  }
}

export class RepositoryUniqueConflictError extends RepositoryError {
  constructor(
    public readonly constraint?: string,
    options?: ErrorOptions,
  ) {
    super('Unique constraint conflict', 'unique_conflict', options)
  }
}

export class RepositoryForeignKeyConflictError extends RepositoryError {
  constructor(
    public readonly constraint?: string,
    options?: ErrorOptions,
  ) {
    super('Foreign key conflict', 'foreign_key_conflict', options)
  }
}

export class RepositoryRevisionConflictError extends RepositoryError {
  constructor(
    public readonly currentRevision?: number,
    options?: ErrorOptions,
  ) {
    super('Revision conflict', 'revision_conflict', options)
  }
}

export class RepositoryNotFoundError extends RepositoryError {
  constructor() {
    super('Resource not found', 'not_found')
  }
}

type MySqlLikeError = Error & { code?: string; errno?: number; sqlState?: string }

export function translateDatabaseError(error: unknown): Error {
  if (error instanceof RepositoryError) return error
  const mysqlError = error as MySqlLikeError
  if (mysqlError?.code === 'ER_DUP_ENTRY' || mysqlError?.errno === 1062) {
    return new RepositoryUniqueConflictError(undefined, { cause: error })
  }
  if (
    ['ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2'].includes(mysqlError?.code || '') ||
    [1451, 1452].includes(mysqlError?.errno || 0)
  ) {
    return new RepositoryForeignKeyConflictError(undefined, { cause: error })
  }
  if (
    ['PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(
      mysqlError?.code || '',
    ) ||
    [1040, 1042, 1043, 2002, 2003, 2006, 2013].includes(mysqlError?.errno || 0)
  ) {
    return new DatabaseUnavailableError({ cause: error })
  }
  return mysqlError instanceof Error
    ? mysqlError
    : new Error('Unknown database error', { cause: error })
}
