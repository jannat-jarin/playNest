import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'
import session from 'express-session'
import bcrypt from 'bcryptjs'
import { builtInGames, categories } from './seed.js'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(root, process.env.DATABASE_PATH)
  : path.join(root, 'data', 'playnest.db')

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const app = express()
const db = new DatabaseSync(dbPath)

db.exec('PRAGMA journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    tag TEXT NOT NULL,
    description TEXT NOT NULL,
    instructions TEXT NOT NULL,
    thumbnail_url TEXT,
    featured INTEGER DEFAULT 0,
    popular INTEGER DEFAULT 0,
    is_new INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    game_type TEXT NOT NULL DEFAULT 'builtin',
    embed_url TEXT,
    built_in INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

// Seed once, so deleting all games does not restore them on restart.
const seeded = db.prepare(
  "SELECT value FROM app_meta WHERE key = 'catalogue_seeded'"
).get()

if (!seeded) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM games').get().n

  db.exec('BEGIN')

  try {
    if (count === 0) {
      const insert = db.prepare(`
        INSERT INTO games (
          id, title, category, tag, description, instructions,
          thumbnail_url, featured, popular, is_new,
          sort_order, game_type, built_in
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      builtInGames.forEach((game, index) => {
        const values = game.slice(0, 10).map(value =>
          typeof value === 'boolean' ? Number(value) : value
        )

        insert.run(...values, index, 'builtin', 1)
      })
    }

    db.prepare(
      'INSERT INTO app_meta (key, value) VALUES (?, ?)'
    ).run('catalogue_seeded', '1')

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

class SqliteStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare(
        'SELECT data FROM sessions WHERE sid = ? AND expires > ?'
      ).get(sid, Date.now())

      callback(null, row ? JSON.parse(row.data) : null)
    } catch (error) {
      callback(error)
    }
  }

  set(sid, sess, callback) {
    try {
      const expires = Date.now() + (sess.cookie?.maxAge || 86400000)

      db.prepare(`
        INSERT INTO sessions (sid, data, expires)
        VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
          data = excluded.data,
          expires = excluded.expires
      `).run(sid, JSON.stringify(sess), expires)

      callback?.()
    } catch (error) {
      callback?.(error)
    }
  }

  destroy(sid, callback) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid)
      callback?.()
    } catch (error) {
      callback?.(error)
    }
  }
}

const production = process.env.NODE_ENV === 'production'
const secret = process.env.SESSION_SECRET ||
  (production ? '' : crypto.randomBytes(32).toString('hex'))

if (!secret) {
  throw new Error('SESSION_SECRET is required in production.')
}

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))

app.use(session({
  store: new SqliteStore(),
  secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    maxAge: 86400000
  }
}))

const toGame = row => ({
  ...row,
  featured: Boolean(row.featured),
  popular: Boolean(row.popular),
  isNew: Boolean(row.is_new),
  art: row.thumbnail_url || '/artwork/neon-drift.svg',
  thumbnailUrl: row.thumbnail_url || '',
  gameType: row.game_type,
  embedUrl: row.embed_url || '',
  builtIn: Boolean(row.built_in)
})

const list = () => db.prepare(`
  SELECT * FROM games
  ORDER BY featured DESC, sort_order, title
`).all().map(toGame)

function requireAdmin(req, res, next) {
  if (!req.session?.admin) {
    return res.status(401).json({ error: 'Owner login required.' })
  }

  next()
}

const allowedDomains = () =>
  (process.env.TRUSTED_EMBED_DOMAINS || '')
    .split(',')
    .map(domain => domain.trim().toLowerCase())
    .filter(Boolean)

function validUrl(value, allowAny = false) {
  if (!value) throw new Error('A game embed URL is required.')

  let url

  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a valid HTTPS URL.')
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Use an HTTPS URL without embedded credentials.')
  }

  if (!allowAny && !allowedDomains().some(domain =>
    url.hostname === domain || url.hostname.endsWith(`.${domain}`)
  )) {
    throw new Error('Embed URL is not from a trusted domain.')
  }

  return url.href
}

function validate(input, existing = {}) {
  input = input || {}

  const game = {
    title: String(input.title || '').trim(),
    category: String(input.category || ''),
    tag: String(input.tag || 'Game').trim(),
    description: String(input.description || '').trim(),
    instructions: String(input.instructions || '').trim(),
    thumbnailUrl: String(input.thumbnailUrl || '').trim(),
    featured: Boolean(input.featured),
    popular: Boolean(input.popular),
    isNew: Boolean(input.isNew),
    sortOrder: Number(input.sortOrder) || 0,
    gameType: existing.game_type || 'external',
    embedUrl: String(input.embedUrl || '').trim()
  }

  if (
    game.title.length < 2 || game.title.length > 60 ||
    game.description.length < 10 || game.description.length > 400 ||
    game.instructions.length < 3 || game.instructions.length > 250
  ) {
    throw new Error('Check title, description, and instructions lengths.')
  }

  if (!categories.includes(game.category)) {
    throw new Error('Choose an existing category.')
  }

  if (!Number.isFinite(game.sortOrder)) {
    throw new Error('Sort order must be a finite number.')
  }

  // Preserve existing local artwork when editing a built-in game.
  const existingLocalArtwork =
    existing.built_in &&
    game.thumbnailUrl === existing.thumbnail_url &&
    game.thumbnailUrl.startsWith('/artwork/')

  if (game.thumbnailUrl && !existingLocalArtwork) {
    game.thumbnailUrl = validUrl(game.thumbnailUrl, true)
  }

  game.embedUrl = game.gameType === 'external'
    ? validUrl(game.embedUrl)
    : ''

  return game
}

app.get('/api/games', (req, res) => {
  res.json({ games: list(), categories })
})

app.get('/api/admin/session', (req, res) => {
  res.json({
    authenticated: Boolean(req.session?.admin),
    categories,
    allowlist: allowedDomains()
  })
})

app.post('/api/admin/login', async (req, res, next) => {
  try {
    const hash = process.env.ADMIN_PASSWORD_HASH

    if (!hash) {
      return res.status(503).json({
        error: 'Admin login is not configured. Set ADMIN_PASSWORD_HASH.'
      })
    }

    const ok = await bcrypt.compare(
      String(req.body?.password || ''),
      hash
    )

    if (!ok) {
      return res.status(401).json({ error: 'Invalid password.' })
    }

    req.session.regenerate(error => {
      if (error) return next(error)

      req.session.admin = true
      req.session.save(error => {
        if (error) return next(error)
        res.json({ ok: true })
      })
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/logout', requireAdmin, (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error)

    res.clearCookie('connect.sid')
    res.json({ ok: true })
  })
})

app.post('/api/admin/games', requireAdmin, (req, res) => {
  try {
    const game = validate(req.body)
    const id = `external-${crypto.randomUUID()}`

    db.prepare(`
      INSERT INTO games (
        id, title, category, tag, description, instructions,
        thumbnail_url, featured, popular, is_new,
        sort_order, game_type, embed_url, built_in
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      id, game.title, game.category, game.tag,
      game.description, game.instructions, game.thumbnailUrl,
      Number(game.featured), Number(game.popular), Number(game.isNew),
      game.sortOrder, 'external', game.embedUrl
    )

    res.status(201).json({
      game: toGame(db.prepare('SELECT * FROM games WHERE id = ?').get(id))
    })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.put('/api/admin/games/:id', requireAdmin, (req, res) => {
  try {
    const row = db.prepare(
      'SELECT * FROM games WHERE id = ?'
    ).get(req.params.id)

    if (!row) {
      return res.status(404).json({ error: 'Game not found.' })
    }

    const game = validate(req.body, row)

    db.prepare(`
      UPDATE games SET
        title = ?, category = ?, tag = ?, description = ?,
        instructions = ?, thumbnail_url = ?, featured = ?,
        popular = ?, is_new = ?, sort_order = ?, embed_url = ?
      WHERE id = ?
    `).run(
      game.title, game.category, game.tag,
      game.description, game.instructions, game.thumbnailUrl,
      Number(game.featured), Number(game.popular), Number(game.isNew),
      game.sortOrder, game.embedUrl, row.id
    )

    res.json({
      game: toGame(
        db.prepare('SELECT * FROM games WHERE id = ?').get(row.id)
      )
    })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.delete('/api/admin/games/:id', requireAdmin, (req, res) => {
  const result = db.prepare(
    'DELETE FROM games WHERE id = ?'
  ).run(req.params.id)

  if (!result.changes) {
    return res.status(404).json({ error: 'Game not found.' })
  }

  res.json({ ok: true })
})

app.use((error, req, res, next) => {
  console.error(error.message)
  res.status(500).json({ error: 'Server error.' })
})

const port = Number(process.env.API_PORT || 3001)

const server = app.listen(port, () => {
  console.log(`PlayNest API on http://localhost:${port}`)
})

server.on('error', error => {
  console.error('API startup failed:', error.message)
  process.exitCode = 1
})