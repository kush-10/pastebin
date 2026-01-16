import Fastify, { type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { createDb, initDb } from './db.js';
import { nanoid } from 'nanoid';
import argon2 from 'argon2';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { sql } from 'kysely';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT ?? 3003);
const SQLITE_PATH = process.env.SQLITE_PATH ?? './data/app.db';
const APP_BASE_URL = process.env.APP_BASE_URL ?? '';
const MAX_DOC_BYTES = Number(process.env.MAX_DOC_BYTES ?? 120_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 30);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const CLEANUP_INTERVAL_MINUTES = Number(process.env.CLEANUP_INTERVAL_MINUTES ?? 10);
const HSTS_ENABLED = process.env.HSTS_ENABLED === 'true';

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

fastify.get('/api/config', async () => ({
  baseUrl: baseUrl()
}));

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
