# Minimal Doc Paste

A super-minimal, black-canvas paste/note app inspired by `textarea`. Documents are stored server-side and shared via short URLs like `/d/<id>`.

## Features

- Blank doc created at `/` and redirected to `/d/<id>`
- WYSIWYG editor (Tiptap) with markdown-style shortcuts
- Share URL + QR code generation
- Optional one-time password lock (cannot be changed once set)
- Optional expiry presets or custom datetime
- IP-based rate limiting on document creation
- Automatic cleanup of expired docs

## Setup

### Local dev (host)

```
npm install
npm run dev
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:3123`

### Docker (production)

```
docker compose up --build
```

### Docker (development)

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## Usage

- Visit `/` to create a new doc and get redirected to `/d/<id>`.
- Save with `Cmd/Ctrl+S`.
- Open the menu with the FAB or `Cmd/Ctrl+K`.
- Press `Escape` to close modals.

## Passwords + expiry

- Setting a password is optional. Once set, it cannot be changed.
- If a doc has a password, it is required for viewing and editing.
- Expiry can be set to 10 min, 1 hour, 1 day, 1 week, or a custom datetime.
- Expired documents return a minimal expired screen and are removed during cleanup.

## API

Auth model A: anyone with the link can edit unless a password is set. If a password exists, it is required for both reads and edits.

- `POST /api/docs` → create new doc
- `GET /api/docs/:id` → fetch doc (optional `x-doc-password` header)
- `PUT /api/docs/:id` → update doc (requires `x-doc-password` when locked)
- `POST /api/docs/:id/password` → set password once
- `POST /api/docs/:id/expiry` → set expiry (`{ "expiresAt": ISO | null }`)
- `GET /api/config` → `{ baseUrl }` for QR links

## Environment

- `APP_BASE_URL` (required for QR correctness behind proxies)
- `SQLITE_PATH` (default `./data/app.db`)
- `PORT` (default `3123`)
- `MAX_DOC_BYTES` (default `120000`)
- `RATE_LIMIT_MAX` (default `30`)
- `RATE_LIMIT_WINDOW_MS` (default `60000`)
- `CLEANUP_INTERVAL_MINUTES` (default `10`)

## Security notes

- Passwords are hashed using Argon2.
- JSON content is stored and rendered via the editor (no raw HTML rendering).
- CSP, referrer policy, and other headers are enabled via `@fastify/helmet`.
- Document pages include `X-Robots-Tag: noindex`.

## Versions

- node: 24.13.0
- npm: 11.7.0
- vite: 7.3.1
- react: 19.2.3
- typescript: 5.9.3
- tailwindcss: 4.1.18
- tiptap: 3.15.3
- fastify: 5.7.0
- kysely: 0.28.9
- better-sqlite3: 12.6.0
- argon2: 0.44.0

Run `npm run versions` to print these from `package.json`.

## Test/seed ideas

- Create a doc, type content, and save (`Cmd/Ctrl+S`).
- Open the share link in a new tab and verify password gate + expiry handling.
- Use the FAB to generate a QR code and verify it opens the doc.
