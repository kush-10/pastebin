import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, Generated } from 'kysely';
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

export interface UserRow {
  id: Generated<number>;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface FavoriteRow {
  id: Generated<number>;
  userId: number;
  url: string;
  title: string;
  createdAt: string;
}

export interface DatabaseSchema {
  documents: DocumentRow;
  users: UserRow;
  favorites: FavoriteRow;
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

  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('passwordHash', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('favorites')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('userId', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('url', 'text', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('favorites_user_id_idx')
    .ifNotExists()
    .on('favorites')
    .column('userId')
    .execute();
};
