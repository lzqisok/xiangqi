import mysql, {
  type Pool,
  type PoolConnection,
  type QueryResult as MySqlQueryResult,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise'
import type { DatabaseConfig } from './config.js'
import { DatabaseUnavailableError, translateDatabaseError } from './errors.js'

export type QueryResult<R> = { rows: R[]; rowCount: number }

export interface Queryable {
  query<R = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>
}

function convertResult<R>(result: MySqlQueryResult): QueryResult<R> {
  if (Array.isArray(result)) return { rows: result as R[], rowCount: result.length }
  const header = result as ResultSetHeader
  return { rows: [], rowCount: header.affectedRows }
}

export class Database {
  private readonly pool: Pool
  private closed = false

  constructor(
    readonly config: DatabaseConfig,
    pool?: Pool,
  ) {
    if (!config.enabled || !config.connectionString) {
      throw new DatabaseUnavailableError({ cause: new Error('Database is disabled') })
    }
    this.pool =
      pool ??
      mysql.createPool({
        uri: config.connectionString,
        connectionLimit: config.poolMax,
        connectTimeout: config.connectionTimeoutMs,
        timezone: 'Z',
        charset: 'utf8mb4',
        supportBigNumbers: true,
        bigNumberStrings: true,
        decimalNumbers: false,
        multipleStatements: false,
        ssl: config.sslMode === 'require' ? {} : undefined,
      })
  }

  async query<R = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    if (this.closed) throw new DatabaseUnavailableError()
    try {
      const [result] = await this.pool.query<RowDataPacket[] | ResultSetHeader>({
        sql: text,
        values: [...values],
        timeout: this.config.queryTimeoutMs,
      })
      return convertResult<R>(result)
    } catch (error) {
      throw translateDatabaseError(error)
    }
  }

  async connection<T>(action: (client: Queryable) => Promise<T>): Promise<T> {
    if (this.closed) throw new DatabaseUnavailableError()
    let connection: PoolConnection | undefined
    try {
      connection = await this.pool.getConnection()
      await this.initializeConnection(connection)
      return await action(this.queryable(connection))
    } catch (error) {
      throw translateDatabaseError(error)
    } finally {
      connection?.release()
    }
  }

  async transaction<T>(action: (client: Queryable) => Promise<T>): Promise<T> {
    if (this.closed) throw new DatabaseUnavailableError()
    let connection: PoolConnection | undefined
    try {
      connection = await this.pool.getConnection()
      await this.initializeConnection(connection)
      await connection.beginTransaction()
      const result = await action(this.queryable(connection))
      await connection.commit()
      return result
    } catch (error) {
      if (connection) await connection.rollback().catch(() => undefined)
      throw translateDatabaseError(error)
    } finally {
      connection?.release()
    }
  }

  async ping(): Promise<void> {
    const result = await this.query<{ version: string; writable: number }>(
      `SELECT VERSION() AS version,
              (@@global.read_only = 0 AND @@global.super_read_only = 0) AS writable`,
    )
    const row = result.rows[0]
    const version = row?.version || ''
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
    const compatible =
      !/mariadb/i.test(version) &&
      Boolean(match) &&
      (Number(match?.[1]) > 8 ||
        (Number(match?.[1]) === 8 && (Number(match?.[2]) > 0 || Number(match?.[3]) >= 16)))
    if (!compatible || Number(row?.writable) !== 1) {
      throw new DatabaseUnavailableError({
        cause: new Error('MySQL 8.0.16+ writable primary required'),
      })
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.pool.end()
  }

  private queryable(connection: PoolConnection): Queryable {
    return {
      query: async <R>(text: string, values: readonly unknown[] = []) => {
        const [result] = await connection.query<RowDataPacket[] | ResultSetHeader>({
          sql: text,
          values: [...values],
          timeout: this.config.queryTimeoutMs,
        })
        return convertResult<R>(result)
      },
    }
  }

  private async initializeConnection(connection: PoolConnection): Promise<void> {
    await connection.query("SET time_zone = '+00:00'")
    await connection.query('SET SESSION MAX_EXECUTION_TIME = ?', [this.config.statementTimeoutMs])
    await connection.query(
      "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
    )
  }
}
