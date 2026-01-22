import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import { createDb, initDb } from './db.js';
import { nanoid } from 'nanoid';
import argon2 from 'argon2';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { sql } from 'kysely';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT ?? 3123);
const SQLITE_PATH = process.env.SQLITE_PATH ?? './data/app.db';
const APP_BASE_URL = process.env.APP_BASE_URL ?? '';
const MAX_DOC_BYTES = Number(process.env.MAX_DOC_BYTES ?? 120_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 30);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const CLEANUP_INTERVAL_MINUTES = Number(process.env.CLEANUP_INTERVAL_MINUTES ?? 10);
const HSTS_ENABLED = process.env.HSTS_ENABLED === 'true';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 7 * 24 * 60 * 60 * 1000);
const AUTH_COOKIE_NAME = 'pb_session';
const AUTH_SECRET = process.env.AUTH_SECRET ?? randomBytes(32).toString('hex');
const IS_PROD = process.env.NODE_ENV === 'production';

const fastify = Fastify({
  logger: true,
  bodyLimit: Math.max(MAX_DOC_BYTES * 2, 64 * 1024)
});

const db = createDb(SQLITE_PATH);
await initDb(db);

await fastify.register(helmet, {
  hsts: HSTS_ENABLED
    ? {
        maxAge: 31536000,
        includeSubDomains: true
      }
    : false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginResourcePolicy: { policy: 'same-origin' }
});

if (process.env.NODE_ENV !== 'production') {
  await fastify.register(cors, { origin: true });
}

await fastify.register(rateLimit, { global: false });
await fastify.register(cookie);

fastify.addHook('onRequest', (request, reply, done) => {
  if (request.url.startsWith('/d/')) {
    reply.header('X-Robots-Tag', 'noindex');
  }
  done();
});

const ensureDocSize = (content: unknown) => {
  const json = JSON.stringify(content ?? {});
  if (Buffer.byteLength(json, 'utf8') > MAX_DOC_BYTES) {
    return null;
  }
  return json;
};

const isExpired = (expiresAt: string | null) => {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= Date.now();
};

const getPassword = (request: FastifyRequest) => {
  const header = request.headers['x-doc-password'];
  if (typeof header === 'string' && header.trim().length > 0) return header;
  const query = (request.query as { password?: string }).password;
  if (typeof query === 'string' && query.trim().length > 0) return query;
  const body = request.body as { password?: string } | undefined;
  if (body?.password && typeof body.password === 'string') return body.password;
  return null;
};

const baseUrl = () => {
  return APP_BASE_URL || '';
};

const base64UrlEncode = (value: string) => Buffer.from(value).toString('base64url');
const base64UrlDecode = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

const signValue = (value: string) =>
  createHmac('sha256', AUTH_SECRET).update(value).digest('base64url');

const buildSessionCookie = (userId: number) => {
  const payload = base64UrlEncode(JSON.stringify({ userId, iat: Date.now() }));
  const signature = signValue(payload);
  return `${payload}.${signature}`;
};

const verifySessionCookie = (value: string) => {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = signValue(payload);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(signatureBuf, expectedBuf)) return null;
  try {
    const decoded = JSON.parse(base64UrlDecode(payload)) as { userId?: number; iat?: number };
    if (!decoded.userId || !decoded.iat) return null;
    if (Date.now() - decoded.iat > SESSION_TTL_MS) return null;
    return decoded.userId;
  } catch {
    return null;
  }
};

const getAuthUser = async (request: FastifyRequest) => {
  const token = request.cookies?.[AUTH_COOKIE_NAME];
  if (!token) return null;
  const userId = verifySessionCookie(token);
  if (!userId) return null;
  const user = await db
    .selectFrom('users')
    .select(['id', 'email', 'createdAt'])
    .where('id', '=', userId)
    .executeTakeFirst();
  return user ?? null;
};

const setAuthCookie = (reply: FastifyReply, userId: number) => {
  const token = buildSessionCookie(userId);
  reply.setCookie(AUTH_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  });
};

fastify.get('/api/config', async () => ({
  baseUrl: baseUrl()
}));

fastify.post('/auth/register', async (request, reply) => {
  const body = request.body as { email?: string; username?: string; password?: string } | undefined;
  const identifier = body?.email ?? body?.username;
  if (!identifier || typeof identifier !== 'string') {
    return reply.code(400).send({ error: 'email_required' });
  }
  if (!body?.password || body.password.length < 6) {
    return reply.code(400).send({ error: 'password_too_short' });
  }
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) {
    return reply.code(400).send({ error: 'email_required' });
  }
  const existing = await db
    .selectFrom('users')
    .select('id')
    .where('email', '=', normalized)
    .executeTakeFirst();
  if (existing) {
    return reply.code(409).send({ error: 'email_taken' });
  }
  const now = new Date().toISOString();
  const hash = await argon2.hash(body.password);
  const result = await db
    .insertInto('users')
    .values({
      email: normalized,
      passwordHash: hash,
      createdAt: now
    })
    .executeTakeFirstOrThrow();
  const userId = Number(result.insertId);
  const user = await db
    .selectFrom('users')
    .select(['id', 'email', 'createdAt'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  setAuthCookie(reply, user.id);
  return { user };
});

fastify.post('/auth/login', async (request, reply) => {
  const body = request.body as { email?: string; username?: string; password?: string } | undefined;
  const identifier = body?.email ?? body?.username;
  if (!identifier || typeof identifier !== 'string') {
    return reply.code(400).send({ error: 'email_required' });
  }
  if (!body?.password) {
    return reply.code(400).send({ error: 'password_required' });
  }
  const normalized = identifier.trim().toLowerCase();
  const user = await db
    .selectFrom('users')
    .select(['id', 'email', 'passwordHash', 'createdAt'])
    .where('email', '=', normalized)
    .executeTakeFirst();
  if (!user) {
    return reply.code(401).send({ error: 'invalid_credentials' });
  }
  const ok = await argon2.verify(user.passwordHash, body.password);
  if (!ok) {
    return reply.code(401).send({ error: 'invalid_credentials' });
  }
  setAuthCookie(reply, user.id);
  return { user: { id: user.id, email: user.email, createdAt: user.createdAt } };
});

fastify.post('/auth/logout', async (_request, reply) => {
  reply.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
  return { ok: true };
});

fastify.get('/auth/me', async (request, reply) => {
  const user = await getAuthUser(request);
  if (!user) {
    reply.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
  }
  return { user };
});

fastify.get('/api/favorites', async (request, reply) => {
  const user = await getAuthUser(request);
  if (!user) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const favorites = await db
    .selectFrom('favorites')
    .select(['id', 'url', 'title', 'createdAt'])
    .where('userId', '=', user.id)
    .orderBy('createdAt', 'desc')
    .execute();
  return { favorites };
});

fastify.post('/api/favorites', async (request, reply) => {
  const user = await getAuthUser(request);
  if (!user) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const body = request.body as { url?: string; title?: string } | undefined;
  const url = body?.url?.trim();
  const title = body?.title?.trim();
  if (!url || !title) {
    return reply.code(400).send({ error: 'missing_fields' });
  }
  const now = new Date().toISOString();
  const result = await db
    .insertInto('favorites')
    .values({
      userId: user.id,
      url,
      title,
      createdAt: now
    })
    .executeTakeFirstOrThrow();
  const favoriteId = Number(result.insertId);
  const favorite = await db
    .selectFrom('favorites')
    .select(['id', 'url', 'title', 'createdAt'])
    .where('id', '=', favoriteId)
    .executeTakeFirstOrThrow();
  return { favorite };
});

fastify.delete('/api/favorites/:id', async (request, reply) => {
  const user = await getAuthUser(request);
  if (!user) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const { id } = request.params as { id: string };
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return reply.code(400).send({ error: 'invalid_id' });
  }
  const result = await db
    .deleteFrom('favorites')
    .where('id', '=', numericId)
    .where('userId', '=', user.id)
    .executeTakeFirst();
  if (!result || result.numDeletedRows === 0n) {
    return reply.code(404).send({ error: 'not_found' });
  }
  return { ok: true };
});

fastify.post(
  '/api/docs',
  {
    config: {
      rateLimit: {
        max: RATE_LIMIT_MAX,
        timeWindow: RATE_LIMIT_WINDOW_MS
      }
    }
  },
  async (request, reply) => {
    const id = nanoid(8);
    const now = new Date().toISOString();
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph' }]
    };
    const json = ensureDocSize(content);
    if (!json) {
      return reply.code(413).send({ error: 'doc_too_large' });
    }
    await db
      .insertInto('documents')
      .values({
        id,
        content: json,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
        passwordHash: null,
        passwordSetAt: null,
        viewCount: 0,
        lastAccessedAt: null
      })
      .execute();

    return { id };
  }
);

fastify.get('/api/docs/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const doc = await db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirst();
  if (!doc) {
    return reply.code(404).send({ error: 'not_found' });
  }
  if (isExpired(doc.expiresAt)) {
    await db.deleteFrom('documents').where('id', '=', id).execute();
    return reply.code(404).send({ error: 'expired' });
  }
  if (doc.passwordHash) {
    const password = getPassword(request);
    if (!password) {
      return reply.code(401).send({ error: 'password_required' });
    }
    const ok = await argon2.verify(doc.passwordHash, password);
    if (!ok) {
      return reply.code(401).send({ error: 'invalid_password' });
    }
  }

  const now = new Date().toISOString();
  await db
    .updateTable('documents')
    .set({
      viewCount: sql`viewCount + 1`,
      lastAccessedAt: now
    })
    .where('id', '=', id)
    .execute();

  return {
    id: doc.id,
    content: JSON.parse(doc.content),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    expiresAt: doc.expiresAt,
    hasPassword: Boolean(doc.passwordHash)
  };
});

fastify.put('/api/docs/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { content?: unknown; password?: string } | undefined;
  if (!body?.content) {
    return reply.code(400).send({ error: 'missing_content' });
  }

  const doc = await db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirst();
  if (!doc) {
    return reply.code(404).send({ error: 'not_found' });
  }
  if (isExpired(doc.expiresAt)) {
    await db.deleteFrom('documents').where('id', '=', id).execute();
    return reply.code(404).send({ error: 'expired' });
  }
  if (doc.passwordHash) {
    const password = getPassword(request);
    if (!password) {
      return reply.code(401).send({ error: 'password_required' });
    }
    const ok = await argon2.verify(doc.passwordHash, password);
    if (!ok) {
      return reply.code(401).send({ error: 'invalid_password' });
    }
  }

  const json = ensureDocSize(body.content);
  if (!json) {
    return reply.code(413).send({ error: 'doc_too_large' });
  }

  const now = new Date().toISOString();
  await db
    .updateTable('documents')
    .set({
      content: json,
      updatedAt: now
    })
    .where('id', '=', id)
    .execute();

  return { ok: true, updatedAt: now };
});

fastify.post('/api/docs/:id/password', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { password?: string } | undefined;
  if (!body?.password || body.password.length < 4) {
    return reply.code(400).send({ error: 'password_required' });
  }

  const doc = await db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirst();
  if (!doc) {
    return reply.code(404).send({ error: 'not_found' });
  }
  if (doc.passwordHash) {
    return reply.code(409).send({ error: 'password_already_set' });
  }

  const now = new Date().toISOString();
  const hash = await argon2.hash(body.password);
  await db
    .updateTable('documents')
    .set({
      passwordHash: hash,
      passwordSetAt: now
    })
    .where('id', '=', id)
    .execute();

  return { ok: true, passwordSetAt: now };
});

fastify.post('/api/docs/:id/expiry', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { expiresAt?: string | null } | undefined;
  if (!body || typeof body.expiresAt === 'undefined') {
    return reply.code(400).send({ error: 'expiresAt_required' });
  }

  const doc = await db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirst();
  if (!doc) {
    return reply.code(404).send({ error: 'not_found' });
  }

  if (body.expiresAt !== null && Number.isNaN(Date.parse(body.expiresAt))) {
    return reply.code(400).send({ error: 'invalid_expiresAt' });
  }

  await db
    .updateTable('documents')
    .set({
      expiresAt: body.expiresAt
    })
    .where('id', '=', id)
    .execute();

  return { ok: true, expiresAt: body.expiresAt };
});

const staticRoot = join(__dirname, '..', '..', 'dist', 'client');
fastify.register(fastifyStatic, {
  root: staticRoot,
  prefix: '/',
  index: false
});

fastify.get('/', async (request, reply) => {
  const indexPath = join(staticRoot, 'index.html');
  try {
    const html = await readFile(indexPath, 'utf8');
    reply.type('text/html').send(html);
  } catch {
    reply.code(404).send('Client build not found');
  }
});

fastify.get('/new', async (_request, reply) => {
  const indexPath = join(staticRoot, 'index.html');
  try {
    const html = await readFile(indexPath, 'utf8');
    reply.type('text/html').send(html);
  } catch {
    reply.code(404).send('Client build not found');
  }
});

fastify.get('/home', async (_request, reply) => {
  const indexPath = join(staticRoot, 'index.html');
  try {
    const html = await readFile(indexPath, 'utf8');
    reply.type('text/html').send(html);
  } catch {
    reply.code(404).send('Client build not found');
  }
});

fastify.get('/login', async (_request, reply) => {
  const indexPath = join(staticRoot, 'index.html');
  try {
    const html = await readFile(indexPath, 'utf8');
    reply.type('text/html').send(html);
  } catch {
    reply.code(404).send('Client build not found');
  }
});

fastify.get('/register', async (_request, reply) => {
  const indexPath = join(staticRoot, 'index.html');
  try {
    const html = await readFile(indexPath, 'utf8');
    reply.type('text/html').send(html);
  } catch {
    reply.code(404).send('Client build not found');
  }
});

fastify.get('/d/:id', async (request, reply) => {
  const indexPath = join(staticRoot, 'index.html');
  try {
    const html = await readFile(indexPath, 'utf8');
    reply.type('text/html').send(html);
  } catch {
    reply.code(404).send('Client build not found');
  }
});

const cleanupExpired = async () => {
  const now = new Date().toISOString();
  await db.deleteFrom('documents').where('expiresAt', '<=', now).execute();
};

setInterval(cleanupExpired, CLEANUP_INTERVAL_MINUTES * 60 * 1000);

try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}
