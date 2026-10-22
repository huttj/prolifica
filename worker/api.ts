import { AutoRouter, error, json, type IRequest, type RequestHandler } from 'itty-router'
import { HANDLE_RE, RESERVED_HANDLES } from '../shared/handle'
import type { AdminUser, Anchor, Visibility } from '../shared/types'
import {
  LINK_TTL_MS, SESSION_COOKIE, SESSION_TTL_MS, adminEmails, appOrigin, clearSessionCookie, getAuth, isAdminEmail, isLocal, islesOrigin, quotaFor, readCookie,
  sessionCookie, toMe,
} from './auth'
import { Db, toPerson, type UserRow } from './db'
import { sendMagicLink, sendStorageGranted, sendStorageRequest } from './email'
import { badLinkPage, confirmLinkPage } from './pages'
import { ogKey, rectsKey, shootLater, shootOldLater, shotKey } from './shots'
import { shotTag, Store, StoreError, type Layer, type PublishInput, type SourceInput } from './store'

type Args = [Env, ExecutionContext]
type AuthedRequest = IRequest & { user: UserRow; viaToken: boolean }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A path on this site to go to after signing in; anything else is dropped. */
export function safeNext(next: unknown): string | null {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && next.length < 4000 ? next : null
}

const withUser: RequestHandler<IRequest, Args> = async (request, env) => {
  const auth = await getAuth(request, env)
  ;(request as AuthedRequest).user = auth?.user as UserRow
  ;(request as AuthedRequest).viaToken = auth?.viaToken ?? false
}

const requireAuth: RequestHandler<IRequest, Args> = (request) => {
  if (!(request as AuthedRequest).user) return error(401, 'Sign in first')
}

const requireSession: RequestHandler<IRequest, Args> = (request) => {
  if (!(request as AuthedRequest).user) return error(401, 'Sign in first')
  if ((request as AuthedRequest).viaToken) return error(403, 'Keys cannot do that; sign in on the site')
}

const requireAdmin: RequestHandler<IRequest, Args> = (request, env) => {
  const user = (request as AuthedRequest).user
  if (!user) return error(401, 'Sign in first')
  if ((request as AuthedRequest).viaToken) return error(403, 'Keys cannot do that; sign in on the site')
  if (!isAdminEmail(env, user.email)) return error(403, 'Only admins can do that')
}

/** Cookie-authenticated writes must come from the app itself (isles are same-site, so SameSite alone is not enough). */
const sameOrigin: RequestHandler<IRequest, Args> = (request, env) => {
  if (request.method === 'GET' || request.method === 'HEAD' || request.headers.get('authorization')) return
  const origin = request.headers.get('origin')
  if (origin !== appOrigin(request, env) && origin !== new URL(request.url).origin) return error(403, 'Cross-origin request refused')
}

const store = (request: IRequest, env: Env) => new Store(env, request as unknown as Request, (request as AuthedRequest).user ?? null)

async function body<T = Record<string, unknown>>(request: IRequest): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new StoreError(400, 'Expected a JSON body')
  }
}

const anchorOf = (v: unknown): Anchor | null => (v && typeof v === 'object' && typeof (v as Anchor).selector === 'string' ? (v as Anchor) : null)

export const api = AutoRouter<IRequest, Args>({
  before: [withUser, sameOrigin],
  catch: (e) => {
    if (e instanceof StoreError) return error(e.status, e.message)
    console.error(e)
    return error(500, 'Something went wrong')
  },
})

// ---- sign-in ----

api.post('/api/auth/request', async (request, env) => {
  const b = await body<{ email?: string; next?: string }>(request)
  const email = String(b.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 254) return error(400, 'That does not look like an email address')
  const d = new Db(env.DB)
  const now = Date.now()
  const recent = await d.recentTokenTimes(email, now - 60 * 60 * 1000)
  if (recent[0] && now - recent[0] < 30_000) return error(429, 'A link is on its way; give it half a minute before asking again')
  if (recent.length >= 6) return error(429, 'Too many sign-in emails this hour; try again later')
  const { token, code } = await d.createLoginToken(email, safeNext(b.next), LINK_TTL_MS)
  const link = `${appOrigin(request as unknown as Request, env)}/auth/verify?token=${encodeURIComponent(token)}`
  if (isLocal(request as unknown as Request)) {
    console.log(`[dev] sign-in for ${email}: ${link}  code ${code}`)
    return json({ ok: true, dev: true })
  }
  await sendMagicLink(env, email, link, code)
  return json({ ok: true })
})

async function signIn(request: IRequest, env: Env, email: string) {
  const d = new Db(env.DB)
  const user = await d.ensureUser(email)
  const session = await d.createSession(user.id, SESSION_TTL_MS)
  return sessionCookie(session, request as unknown as Request)
}

api.post('/api/auth/code', async (request, env) => {
  const b = await body<{ email?: string; code?: string }>(request)
  const email = String(b.email ?? '').trim().toLowerCase()
  const r = await new Db(env.DB).redeemLoginCode(email, String(b.code ?? ''))
  if (!r) return error(400, 'That code did not work (or has expired)')
  return json({ ok: true, next: r.next ?? '/' }, { headers: { 'set-cookie': await signIn(request, env, r.email) } })
})

api.get('/auth/verify', async (request, env) => {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  const peek = await new Db(env.DB).peekLoginToken(token)
  return peek ? confirmLinkPage(token, peek.email) : badLinkPage()
})

api.post('/auth/verify', async (request, env) => {
  const form = await request.formData()
  const r = await new Db(env.DB).redeemLoginToken(String(form.get('token') ?? ''))
  if (!r) return badLinkPage()
  return new Response(null, { status: 303, headers: { location: r.next ?? '/', 'set-cookie': await signIn(request, env, r.email) } })
})

api.post('/api/auth/logout', async (request, env) => {
  const sid = readCookie(request as unknown as Request, SESSION_COOKIE)
  if (sid) await new Db(env.DB).deleteSession(sid)
  return json({ ok: true }, { headers: { 'set-cookie': clearSessionCookie(request as unknown as Request) } })
})

// ---- me ----

api.get('/api/me', requireAuth, async (request, env) => {
  const s = store(request, env)
  const { bytes } = await s.usage((request as AuthedRequest).user.id)
  return toMe(env, (request as AuthedRequest).user, bytes)
})

/** The button by the storage bar: the admins get an email (once, until one of them answers). */
api.post('/api/me/storage-request', requireSession, async (request, env) => {
  const me = (request as AuthedRequest).user
  const quota = quotaFor(env, me)
  if (!Number.isFinite(quota)) return error(400, 'You have no storage limit')
  if (!(await new Db(env.DB).requestStorage(me.id))) return { ok: true, already: true }
  const { bytes } = await store(request, env).usage(me.id)
  const who = me.handle ? `@${me.handle} (${me.email})` : me.email
  const link = `${appOrigin(request as unknown as Request, env)}/admin`
  if (isLocal(request as unknown as Request)) console.log(`[dev] ${who} asks for more storage: ${link}`)
  else await Promise.all(adminEmails(env).map((to) => sendStorageRequest(env, to, who, fmtMB(bytes), fmtMB(quota), link)))
  return { ok: true }
})

api.patch('/api/me', requireSession, async (request, env) => {
  const b = await body<{ handle?: string; name?: string; bio?: string }>(request)
  const patch: { handle?: string; name?: string | null; bio?: string | null } = {}
  if (b.handle !== undefined) {
    const h = String(b.handle).trim().toLowerCase().replace(/^@/, '')
    if (!HANDLE_RE.test(h)) return error(400, 'Handles are 2–24 letters, numbers, - or _')
    if (RESERVED_HANDLES.has(h)) return error(400, 'That handle is reserved')
    patch.handle = h
  }
  if (b.name !== undefined) patch.name = String(b.name).trim().slice(0, 60) || null
  if (b.bio !== undefined) patch.bio = String(b.bio).trim().slice(0, 300) || null
  const d = new Db(env.DB)
  if (!(await d.updateProfile((request as AuthedRequest).user.id, patch))) return error(409, 'That handle is taken')
  const s = store(request, env)
  const { bytes } = await s.usage((request as AuthedRequest).user.id)
  return toMe(env, (await d.userById((request as AuthedRequest).user.id))!, bytes)
})

api.get('/api/me/tokens', requireSession, (request, env) => new Db(env.DB).listApiTokens((request as AuthedRequest).user.id))
api.post('/api/me/tokens', requireSession, async (request, env) => {
  const d = new Db(env.DB)
  if ((await d.listApiTokens((request as AuthedRequest).user.id)).length >= 10) return error(400, 'Ten keys at most; revoke one first')
  const b = await body<{ label?: string }>(request)
  return d.createApiToken((request as AuthedRequest).user.id, String(b.label ?? '').trim().slice(0, 60) || 'Key')
})
api.delete('/api/me/tokens/:id', requireSession, async (request, env) => {
  const ok = await new Db(env.DB).revokeApiToken((request as AuthedRequest).user.id, decodeURIComponent(request.params.id!))
  return ok ? json({ ok }) : error(404, 'No such key')
})

// ---- people ----

api.get('/api/people/:handle', async (request, env) => {
  const d = new Db(env.DB)
  const u = await d.userByHandle(request.params.handle!.replace(/^@/, ''))
  if (!u) return error(404, 'No one by that handle')
  const me = (request as AuthedRequest).user
  return { person: toPerson(u), following: me ? await d.isFollowing(me.id, u.id) : false, isMe: me?.id === u.id }
})
api.post('/api/people/:handle/follow', requireAuth, async (request, env) => {
  const d = new Db(env.DB)
  const u = await d.userByHandle(request.params.handle!)
  if (!u) return error(404, 'No one by that handle')
  const b = await body<{ on?: boolean }>(request)
  if (b.on === false) await d.unfollow((request as AuthedRequest).user.id, u.id)
  else if (u.id !== (request as AuthedRequest).user.id) await d.follow((request as AuthedRequest).user.id, u.id)
  return { following: b.on !== false }
})

async function ownerIdFor(env: Env, handle: string | null) {
  if (!handle) return undefined
  const u = await new Db(env.DB).userByHandle(handle.replace(/^@/, ''))
  if (!u) throw new StoreError(404, 'No one by that handle')
  return u.id
}

// ---- isles ----

api.get('/api/isles', async (request, env) => {
  const q = new URL(request.url).searchParams
  return store(request, env).listIsles({
    ownerId: await ownerIdFor(env, q.get('handle')),
    q: q.get('q') ?? undefined,
    sort: q.get('sort') === 'stars' ? 'stars' : 'recent',
    limit: Number(q.get('limit')) || 40,
    offset: Number(q.get('offset')) || 0,
  })
})
/** Publish a page made elsewhere (Codinger), the same as the MCP publish_isle: new, an update (id) or a remix (parent). */
api.post('/api/isles', requireAuth, async (request, env, ctx) => {
  const b = await body<Omit<PublishInput, 'sourceBlob'>>(request)
  const out = await store(request, env).publishIsle({
    id: b.id, html: b.html, from: b.from, title: b.title, description: b.description, slots: b.slots, bindings: b.bindings,
    parent: b.parent, uses: b.uses, visibility: b.visibility, note: b.note, view: b.view, drawsFrom: b.drawsFrom,
    changes: b.changes, shortTitle: b.shortTitle, viewName: b.viewName, instructions: b.instructions,
  })
  shootLater(ctx, env, out.isle.id, islesOrigin(request, env))
  return out
})
api.get('/api/isles/:id', async (request, env) => (await store(request, env).getIsle(request.params.id!)).isle)
api.get('/api/isles/:id/source', async (request, env) => {
  const v = Number(new URL(request.url).searchParams.get('v')) || undefined
  return new Response(await store(request, env).isleSource(request.params.id!, v), { headers: { 'content-type': 'text/plain; charset=utf-8' } })
})
api.get('/api/isles/:id/evolution', (request, env) => store(request, env).evolution(request.params.id!))
api.get('/api/isles/:id/sources', (request, env) => store(request, env).isleSources(request.params.id!))
api.patch('/api/isles/:id', requireAuth, async (request, env) => {
  const b = await body<{ title?: string; description?: string | null; visibility?: Visibility; shortTitle?: string | null; viewName?: string | null }>(request)
  return (await store(request, env).publishIsle({ id: request.params.id, title: b.title, description: b.description, visibility: b.visibility, shortTitle: b.shortTitle, viewName: b.viewName })).isle
})
api.delete('/api/isles/:id', requireAuth, async (request, env) => {
  await store(request, env).deleteIsle(request.params.id!)
  return { ok: true }
})
/** Same page, your data: the one remix the site itself can do without an agent. */
api.post('/api/isles/:id/rebind', requireAuth, async (request, env, ctx) => {
  const b = await body<{ bindings?: Record<string, string>; title?: string }>(request)
  const { isle } = await store(request, env).publishIsle({ parent: request.params.id, from: request.params.id, bindings: b.bindings, title: b.title })
  shootLater(ctx, env, isle.id, islesOrigin(request, env))
  return isle
})
/** The isle's picture (?og: the JPEG for link previews). Asking for one that's missing or out of date gets a new one taken. */
api.get('/api/isles/:id/shot', async (request, env, ctx) => {
  const row = await store(request, env).visibleIsleRow(request.params.id!)
  if (row.shot_version !== row.version) shootLater(ctx, env, row.id, islesOrigin(request, env))
  const q = new URL(request.url).searchParams
  // ?og&of=<n>: the og picture of an older version (the current one's while it has none yet)
  const of = Number(q.get('of'))
  if (q.has('og') && Number.isInteger(of) && of > 0 && of < row.version) {
    const og = await env.BLOBS.get(ogKey(row.id, of))
    if (og) {
      const cache = row.visibility === 'private' ? 'private, max-age=600' : q.get('v') === `${of}s${row.squashes}` ? 'public, max-age=31536000, immutable' : 'public, max-age=60'
      return new Response(og.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': cache, 'x-content-type-options': 'nosniff' } })
    }
    shootOldLater(ctx, env, row.id, of, islesOrigin(request, env))
  }
  const rects = q.has('rects')
  let obj = row.shot_version ? await env.BLOBS.get((rects ? rectsKey : shotKey)(row.id, row.shot_version)) : null
  let type = rects ? 'application/json' : 'image/webp'
  if (q.has('og') && obj && row.shot_version) {
    const og = await env.BLOBS.get(ogKey(row.id, row.shot_version))
    // a shot from before link previews: hand out the WebP meanwhile
    if (og) (obj = og), (type = 'image/jpeg')
    else if (row.shot_version === row.version) shootLater(ctx, env, row.id, islesOrigin(request, env), true)
  }
  if (!obj) return new Response(rects ? 'null' : 'No picture yet', { status: rects ? 200 : 404, headers: { 'content-type': rects ? 'application/json' : 'text/plain', 'cache-control': 'no-store' } })
  const final = q.get('v') === shotTag(row) && !(q.has('og') && (type === 'image/webp' || q.has('of')))
  const cache = row.visibility === 'private' ? 'private, max-age=600' : final ? 'public, max-age=31536000, immutable' : 'public, max-age=60'
  return new Response(obj.body, { headers: { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' } })
})
api.get('/api/isles/:id/lineage', (request, env) => store(request, env).isleLineage(request.params.id!))
api.get('/api/isles/:id/marks', (request, env) => {
  const layer = new URL(request.url).searchParams.get('layer') as Layer | null
  return store(request, env).marks(request.params.id!, layer && ['mine', 'author', 'following', 'everyone'].includes(layer) ? layer : 'following')
})
api.post('/api/isles/:id/star', requireAuth, async (request, env) => {
  const b = await body<{ anchor?: Anchor; on?: boolean; snippet?: string }>(request)
  return { on: await store(request, env).star(request.params.id!, { anchor: anchorOf(b.anchor), on: b.on, snippet: b.snippet }) }
})
api.post('/api/isles/:id/react', requireAuth, async (request, env) => {
  const b = await body<{ comment?: string; on?: boolean; emoji?: string }>(request)
  return { on: await store(request, env).react(request.params.id!, String(b.comment ?? ''), String(b.emoji ?? ''), { on: b.on }) }
})
api.get('/api/isles/:id/versions', (request, env) => store(request, env).versions(request.params.id!))
api.post('/api/isles/:id/restore', requireAuth, async (request, env, ctx) => {
  const b = await body<{ version?: number }>(request)
  const out = await store(request, env).restoreVersion(request.params.id!, Number(b.version))
  shootLater(ctx, env, request.params.id!, islesOrigin(request, env))
  return out
})
api.patch('/api/isles/:id/versions/:version', requireAuth, async (request, env) => {
  const b = await body<{ note?: string | null }>(request)
  if (b.note !== null && typeof b.note !== 'string') throw new StoreError(400, 'Give note: the new text, or null to clear it')
  return { isle: await store(request, env).setVersionNote(request.params.id!, Number(request.params.version), b.note) }
})
api.post('/api/isles/:id/squash', requireAuth, async (request, env, ctx) => {
  const b = await body<{ from?: number; to?: number; note?: string | null }>(request)
  const out = await store(request, env).squashVersions(request.params.id!, { from: b.from === undefined ? undefined : Number(b.from), to: b.to === undefined ? undefined : Number(b.to), note: b.note })
  shootLater(ctx, env, request.params.id!, islesOrigin(request, env))
  return out
})
api.post('/api/isles/:id/comments', requireAuth, async (request, env) => {
  const b = await body<{ anchor?: Anchor; body?: string; replyTo?: string; snippet?: string }>(request)
  return store(request, env).comment(request.params.id!, String(b.body ?? ''), { anchor: anchorOf(b.anchor), replyTo: b.replyTo ?? null, snippet: b.snippet })
})
api.delete('/api/marks/:id', requireAuth, async (request, env) => {
  await store(request, env).deleteMark(request.params.id!)
  return { ok: true }
})

api.get('/api/sites', (request, env) => store(request, env).sites())
api.get('/api/sites/:site', (request, env) => store(request, env).site(decodeURIComponent(request.params.site!)))
api.get('/api/collectors/:hash', async (request, env) => {
  const code = await store(request, env).collectorByHash(request.params.hash!)
  return new Response(code, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' } })
})

api.get('/api/forest', (request, env) => store(request, env).forest())
api.get('/api/chart', async (request, env) =>
  Response.json(await store(request, env).chart(), { headers: { 'cache-control': 'public, max-age=30' } }),
)

api.get('/api/library', async (request, env) => {
  const handle = new URL(request.url).searchParams.get('handle')
  const s = store(request, env)
  if (!handle && !s.viewer) return error(401, 'Sign in first')
  return s.library(await ownerIdFor(env, handle))
})

// ---- data ----

api.get('/api/data', async (request, env) => {
  const q = new URL(request.url).searchParams
  const s = store(request, env)
  const ownerId = await ownerIdFor(env, q.get('handle'))
  if (!ownerId && !s.viewer) return error(401, 'Sign in first')
  return s.listDatasets({ ownerId, folder: q.get('folder') ?? undefined })
})

/** Whether this person already has data at that path (a replacement keeps its provenance). */
async function hasDataAt(request: IRequest, env: Env, path: string) {
  const me = (request as AuthedRequest).user
  return !!(await env.DB.prepare('SELECT 1 AS x FROM datasets WHERE owner_id = ? AND path = ? AND deleted_at IS NULL').bind(me.id, path.split('/').map((p) => p.trim()).filter(Boolean).join('/')).first())
}

/** Upload: the body is the file, ?path= names it. */
api.post('/api/data', requireAuth, async (request, env) => {
  const q = new URL(request.url).searchParams
  const path = q.get('path')
  if (!path) return error(400, 'Name it with ?path=')
  const len = Number(request.headers.get('content-length') ?? 0)
  if (len > 20 * 1024 * 1024) return error(413, 'Too big')
  const bytes = new Uint8Array(await request.arrayBuffer())
  return store(request, env).writeDataset({
    path,
    bytes,
    contentType: request.headers.get('content-type') ?? undefined,
    description: q.get('description'),
    public: q.get('public') === '1' ? true : undefined,
    // a file dropped on the site was uploaded, unless it is replacing data that already says otherwise
    source: (await hasDataAt(request, env, path)) ? undefined : { method: 'upload' },
  })
})
api.get('/api/data/:id', async (request, env) => (await store(request, env).getDataset(request.params.id!)).dataset)
api.get('/api/data/:id/raw', async (request, env) => {
  const s = store(request, env)
  const { dataset, row } = await s.getDataset(request.params.id!)
  const obj = await s.getBlob(row.blob)
  if (!obj) return error(404, 'The bytes are missing')
  return new Response(obj.body, {
    headers: {
      'content-type': dataset.contentType.startsWith('text/') ? `${dataset.contentType}; charset=utf-8` : dataset.contentType,
      'content-security-policy': "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-cache',
    },
  })
})
api.patch('/api/data/:id', requireAuth, async (request, env) => {
  const b = await body<{ path?: string; description?: string | null; public?: boolean; source?: SourceInput; derived_from?: string[] }>(request)
  const { derived_from, ...patch } = b
  return store(request, env).updateDatasetMeta(request.params.id!, { ...patch, derivedFrom: Array.isArray(derived_from) ? derived_from.map(String) : undefined })
})
api.get('/api/data/:id/collector', async (request, env) => {
  const code = await store(request, env).collectorCode(request.params.id!)
  return code === null ? error(404, 'No collector code recorded') : new Response(code, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' } })
})
api.get('/api/data/:id/same-collector', (request, env) => store(request, env).sameCollector(request.params.id!))
api.put('/api/data/:id/content', requireAuth, async (request, env) => {
  const s = store(request, env)
  const { row } = await s.getDataset(request.params.id!)
  return s.writeDataset({ id: row.id, path: row.path, bytes: new Uint8Array(await request.arrayBuffer()), contentType: row.content_type })
})
api.delete('/api/data/:id', requireAuth, async (request, env) => {
  await store(request, env).deleteDataset(request.params.id!)
  return { ok: true }
})
api.get('/api/data/:id/lineage', (request, env) => store(request, env).dataLineage(request.params.id!))

// ---- admin ----

const fmtMB = (n: number) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`)

api.get('/api/admin/users', requireAdmin, async (request, env): Promise<AdminUser[]> => {
  const s = store(request, env)
  const out: AdminUser[] = []
  for (const u of await new Db(env.DB).allUsers()) {
    const q = quotaFor(env, u)
    out.push({
      id: u.id, email: u.email, handle: u.handle, name: u.name, createdAt: u.created_at, lastLoginAt: u.last_login_at,
      usage: (await s.usage(u.id)).bytes, quota: Number.isFinite(q) ? q : null, customQuota: u.quota_bytes ?? null, requestedAt: u.quota_requested_at ?? null,
    })
  }
  return out
})

/** Set someone's storage limit in bytes (null: the default). It answers their request, and tells them by email when they asked. */
api.patch('/api/admin/users/:id', requireAdmin, async (request, env) => {
  const b = await body<{ quota?: number | null }>(request)
  const quota = b.quota === null ? null : Number(b.quota)
  if (quota !== null && !(Number.isInteger(quota) && quota > 0 && quota <= 1024 ** 4)) return error(400, 'quota is a number of bytes, or null for the default')
  const db = new Db(env.DB)
  const u = await db.userById(request.params.id!)
  if (!u) return error(404, 'No such person')
  await db.setQuota(u.id, quota)
  if (u.quota_requested_at) {
    const now = quotaFor(env, { ...u, quota_bytes: quota })
    const link = `${appOrigin(request as unknown as Request, env)}/data`
    if (isLocal(request as unknown as Request)) console.log(`[dev] ${u.email} now has ${fmtMB(now)}: ${link}`)
    else if (Number.isFinite(now)) await sendStorageGranted(env, u.email, fmtMB(now), link)
  }
  return { ok: true }
})

api.all('/api/*', () => error(404, 'No such endpoint'))
