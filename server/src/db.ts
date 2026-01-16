import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface DocumentRow {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  passwordHash: string | null;
  passwordSetAt: string | null;
  viewCount: number;
  lastAccessedAt: string | null;
}

export interface DatabaseSchema {
  documents: DocumentRow;
}

export const createDb = (dbPath: string) => {
  mkdirSync(dirname(dbPath), { recursive: true });
  const database = new Database(dbPath);
  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database })
  });
};

export const initDb = async (db: Kysely<DatabaseSchema>) => {
  await db.schema
    .createTable('documents')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .addColumn('updatedAt', 'text', (col) => col.notNull())
    .addColumn('expiresAt', 'text')
    .addColumn('passwordHash', 'text')
    .addColumn('passwordSetAt', 'text')
    .addColumn('viewCount', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('lastAccessedAt', 'text')
    .execute();
};
