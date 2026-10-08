import type { ApiToken, Person } from '../shared/types'

/** People, sign-in, sessions, keys and follows. Content lives in store.ts. */

export interface UserRow {
  id: string
  email: string
  handle: string | null
  name: string | null
  bio: string | null
  created_at: number
  last_login_at: number | null
}

export function toPerson(u: Pick<UserRow, 'id' | 'handle' | 'name' | 'bio'>): Person {
  return { id: u.id, handle: u.handle, name: u.name, bio: u.bio }
}

export function randomId(bytes = 12) {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

/** Short ids for things that show up in URLs. */
export function shortId(len = 10) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789'
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => alphabet[b % alphabet.length]).join('')
}

export function base64url(buf: Uint8Array) {
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return base64url(new Uint8Array(digest))
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const TOKEN_PREFIX = 'pro_'

export class Db {
  constructor(private d1: D1Database) {}

  // ---- users ----

  userById(id: string) {
    return this.d1.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()
  }

  userByEmail(email: string) {
    return this.d1.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>()
  }

  userByHandle(handle: string) {
    return this.d1.prepare('SELECT * FROM users WHERE handle = ?').bind(handle.toLowerCase()).first<UserRow>()
  }

  async usersByIds(ids: string[]): Promise<Map<string, UserRow>> {
    const out = new Map<string, UserRow>()
    const unique = [...new Set(ids)]
    for (let i = 0; i < unique.length; i += 50) {
      const chunk = unique.slice(i, i + 50)
      const { results } = await this.d1
        .prepare(`SELECT * FROM users WHERE id IN (${chunk.map(() => '?').join(',')})`)
        .bind(...chunk)
        .all<UserRow>()
      for (const u of results) out.set(u.id, u)
    }
    return out
  }

  async ensureUser(email: string): Promise<UserRow> {
    const existing = await this.userByEmail(email)
    if (existing) return existing
    const row: UserRow = { id: randomId(), email, handle: null, name: null, bio: null, created_at: Date.now(), last_login_at: null }
    await this.d1.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(row.id, row.email, row.created_at).run()
    return row
  }

  /** Returns false when the handle is taken. */
  async updateProfile(id: string, patch: { name?: string | null; handle?: string; bio?: string | null }): Promise<boolean> {
    const sets: string[] = []
    const args: unknown[] = []
    if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
    if (patch.handle !== undefined) { sets.push('handle = ?'); args.push(patch.handle) }
    if (patch.bio !== undefined) { sets.push('bio = ?'); args.push(patch.bio) }
    if (!sets.length) return true
    try {
      await this.d1.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run()
      return true
    } catch (e) {
      if (String(e).includes('UNIQUE')) return false
      throw e
    }
  }

  // ---- personal keys ----

  /** Mints a key; the secret is returned once and only its hash is kept. */
  async createApiToken(userId: string, label: string): Promise<{ token: string; row: ApiToken }> {
    const token = `${TOKEN_PREFIX}${randomId(24)}`
    const hash = await sha256(token)
    const now = Date.now()
    const prefix = token.slice(0, 9)
    await this.d1
      .prepare('INSERT INTO api_tokens (token_hash, user_id, label, prefix, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(hash, userId, label, prefix, now)
      .run()
    return { token, row: { id: hash, label, prefix, createdAt: now, lastUsedAt: null } }
  }

  async listApiTokens(userId: string): Promise<ApiToken[]> {
    const { results } = await this.d1
      .prepare('SELECT token_hash, label, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
      .bind(userId)
      .all<{ token_hash: string; label: string; prefix: string; created_at: number; last_used_at: number | null }>()
    return results.map((r) => ({ id: r.token_hash, label: r.label, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at }))
  }

  async revokeApiToken(userId: string, id: string): Promise<boolean> {
    const res = await this.d1.prepare('UPDATE api_tokens SET revoked_at = ? WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL').bind(Date.now(), id, userId).run()
    return !!res.meta.changes
  }

  /** The person a key acts as, or null when it is unknown or revoked. Notes the use now and then. */
  async userByApiToken(token: string): Promise<UserRow | null> {
    const hash = await sha256(token)
    const row = await this.d1
      .prepare('SELECT u.*, t.last_used_at AS token_used_at FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.revoked_at IS NULL')
      .bind(hash)
      .first<UserRow & { token_used_at: number | null }>()
    if (!row) return null
    const { token_used_at, ...user } = row
    const now = Date.now()
    if (!token_used_at || now - token_used_at > 10 * 60 * 1000) {
      await this.d1.prepare('UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?').bind(now, hash).run()
    }
    return user
  }

  // ---- sign-in links ----

  async recentTokenTimes(email: string, since: number): Promise<number[]> {
    const { results } = await this.d1
      .prepare('SELECT created_at FROM login_tokens WHERE email = ? AND created_at > ? ORDER BY created_at DESC')
      .bind(email, since)
      .all<{ created_at: number }>()
    return results.map((r) => r.created_at)
  }

  /** A link token and a 6-digit code for the same sign-in; either works once. */
  async createLoginToken(email: string, next: string | null, ttlMs: number): Promise<{ token: string; code: string }> {
    const token = randomId(32)
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const code = String(buf[0]! % 1_000_000).padStart(6, '0')
    const now = Date.now()
    await this.d1.batch([
      this.d1.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now - 60 * 60 * 1000),
      this.d1
        .prepare('INSERT INTO login_tokens (token_hash, email, next, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(await sha256(token), email, next, await sha256(`${email}:${code}`), now, now + ttlMs),
    ])
    return { token, code }
  }

  /** Whether a link is still good, without spending it (the confirm page shows first). */
  async peekLoginToken(token: string): Promise<{ email: string; next: string | null } | null> {
    const row = await this.d1
      .prepare('SELECT email, next, expires_at, used_at FROM login_tokens WHERE token_hash = ?')
      .bind(await sha256(token))
      .first<{ email: string; next: string | null; expires_at: number; used_at: number | null }>()
    if (!row || row.used_at !== null || row.expires_at < Date.now()) return null
    return { email: row.email, next: row.next }
  }

  /** Spends the link; returns its email and where to go next, or null when it is unknown, used or expired. */
  async redeemLoginToken(token: string): Promise<{ email: string; next: string | null } | null> {
    const peek = await this.peekLoginToken(token)
    if (!peek) return null
    const res = await this.d1
      .prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
      .bind(Date.now(), await sha256(token))
      .run()
    return res.meta.changes ? peek : null
  }

  /** Spends the newest live code for that email. Five wrong guesses and the code is dead. */
  async redeemLoginCode(email: string, code: string): Promise<{ email: string; next: string | null } | null> {
    const now = Date.now()
    const row = await this.d1
      .prepare('SELECT token_hash, code_hash, next, attempts FROM login_tokens WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
      .bind(email, now)
      .first<{ token_hash: string; code_hash: string | null; next: string | null; attempts: number }>()
    if (!row || !row.code_hash || row.attempts >= 5) return null
    if (row.code_hash !== (await sha256(`${email}:${code.replace(/\D/g, '')}`))) {
      await this.d1.prepare('UPDATE login_tokens SET attempts = attempts + 1 WHERE token_hash = ?').bind(row.token_hash).run()
      return null
    }
    const res = await this.d1.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').bind(now, row.token_hash).run()
    return res.meta.changes ? { email, next: row.next } : null
  }

  // ---- sessions ----

  async createSession(userId: string, ttlMs: number): Promise<string> {
    const id = randomId(32)
    const now = Date.now()
    await this.d1.batch([
      this.d1.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(id), userId, now, now + ttlMs),
      this.d1.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, userId),
    ])
    return id
  }

  async sessionUser(sessionId: string): Promise<UserRow | null> {
    return this.d1
      .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?')
      .bind(await sha256(sessionId), Date.now())
      .first<UserRow>()
  }

  async deleteSession(sessionId: string) {
    await this.d1.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(sessionId)).run()
  }

  // ---- follows ----

  async follow(followerId: string, followeeId: string) {
    await this.d1.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').bind(followerId, followeeId, Date.now()).run()
  }

  async unfollow(followerId: string, followeeId: string) {
    await this.d1.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').bind(followerId, followeeId).run()
  }

  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    return !!(await this.d1.prepare('SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?').bind(followerId, followeeId).first())
  }

  async followingIds(userId: string): Promise<string[]> {
    const { results } = await this.d1.prepare('SELECT followee_id FROM follows WHERE follower_id = ? LIMIT 500').bind(userId).all<{ followee_id: string }>()
    return results.map((r) => r.followee_id)
  }
}
