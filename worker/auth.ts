import type { Me } from '../shared/types'
import { Db, TOKEN_PREFIX, base64url, type UserRow } from './db'

export const SESSION_COOKIE = 'pro_session'
export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000
export const LINK_TTL_MS = 15 * 60 * 1000

export function isAdminEmail(env: Env, email: string) {
  // ADMINS is a secret (wrangler secret put ADMINS; .dev.vars locally): a comma-separated list of emails
  return (env.ADMINS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase())
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function secure(request: Request) {
  return new URL(request.url).protocol === 'https:' ? '; Secure' : ''
}

export function sessionCookie(value: string, request: Request) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure(request)}`
}

export function clearSessionCookie(request: Request) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(request)}`
}

export const TOKEN_RE = new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{20,}$`)

export function readBearer(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
  return m && TOKEN_RE.test(m[1]!) ? m[1]! : null
}

/**
 * Who is asking, and how. A personal key acts as its person for everything
 * but managing keys and sessions (those routes check `viaToken`).
 */
export async function getAuth(request: Request, env: Env): Promise<{ user: UserRow; viaToken: boolean } | null> {
  const bearer = readBearer(request)
  if (bearer) {
    const user = await new Db(env.DB).userByApiToken(bearer)
    return user ? { user, viaToken: true } : null
  }
  const sessionId = readCookie(request, SESSION_COOKIE)
  if (!sessionId) return null
  const user = await new Db(env.DB).sessionUser(sessionId)
  return user ? { user, viaToken: false } : null
}

export function isLocal(request: Request) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(new URL(request.url).origin)
}

/** The app's public origin. Local dev uses localhost on the request's port. */
export function appOrigin(request: Request, env: Env) {
  if (!isLocal(request)) return env.SITE_URL
  const u = new URL(request.url)
  return `${u.protocol}//localhost:${u.port}`
}

/** Where isles run: another origin, so a page can never see the app's cookies or storage. */
export function islesOrigin(request: Request, env: Env) {
  if (!isLocal(request)) return env.ISLES_URL
  const u = new URL(request.url)
  return `${u.protocol}//127.0.0.1:${u.port}`
}

export function isIslesHost(request: Request, env: Env) {
  const origin = new URL(request.url).origin
  return origin === islesOrigin(request, env) && origin !== appOrigin(request, env)
}

export function toMe(env: Env, u: UserRow, usage: number): Me {
  const q = quotaFor(env, u)
  return { id: u.id, email: u.email, handle: u.handle, name: u.name, bio: u.bio, isAdmin: isAdminEmail(env, u.email), usage, quota: Number.isFinite(q) ? q : null, connected: !!u.mcp_seen_at }
}

/** Bytes a person may keep: their own limit if they have one; admins (the site's own people) get more. */
export function quotaFor(env: Env, u: Pick<UserRow, 'email' | 'quota_bytes'>) {
  if (u.quota_bytes) return u.quota_bytes
  if (isAdminEmail(env, u.email)) return Number(env.ADMIN_QUOTA_BYTES) || 100 * 1024 * 1024
  return Number(env.QUOTA_BYTES) || 5 * 1024 * 1024
}

// ---- signed frame links for private isles ----

async function hmac(env: Env, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))))
}

/** A grant to view one isle (and the data bound to it) until `exp`. */
export async function signIsle(env: Env, isleId: string, ttlMs = 6 * 60 * 60 * 1000) {
  const exp = Date.now() + ttlMs
  return `${exp}.${await hmac(env, `isle:${isleId}:${exp}`)}`
}

export async function verifyIsle(env: Env, isleId: string, grant: string | null) {
  if (!grant) return false
  const [exp, sig] = grant.split('.')
  if (!exp || !sig || Number(exp) < Date.now()) return false
  return (await hmac(env, `isle:${isleId}:${exp}`)) === sig
}
