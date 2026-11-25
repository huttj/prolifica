import { beforeEach, describe, expect, it } from 'vitest'
import type { IsleData } from '../shared/types'
import { assetOr404, isleMarkdown, isleShellParts, llmsTxt, looksLikeFile } from './agent'
import { api } from './api'
import { SESSION_COOKIE } from './auth'
import { Db, type UserRow } from './db'
import { Store } from './store'
import { testCtx, testEnv } from './testenv'

const APP = 'https://prolifica.app'
const bytes = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>

let env: Env
let alice: UserRow
let cookie: string
let pub: string
let unlisted: string
let priv: string
let ids: Record<string, string>

const as = (user: UserRow | null) => new Store(env, new Request(`${APP}/api/x`), user)
const get = (path: string, headers: Record<string, string> = {}) => api.fetch(new Request(`${APP}${path}`, { headers: { 'user-agent': 'test-agent/1.0', ...headers } }), env, testCtx) as Promise<Response>
const signedIn = (path: string) => get(path, { cookie: `${SESSION_COOKIE}=${encodeURIComponent(cookie)}` })

beforeEach(async () => {
  env = testEnv()
  const db = new Db(env.DB)
  alice = await db.ensureUser('alice@test.invalid')
  await db.updateProfile(alice.id, { handle: 'alice' })
  alice = (await db.userById(alice.id))!
  cookie = await db.createSession(alice.id, 60_000)
  const s = as(alice)
  const gen = await s.writeDataset({ path: 'sim/run.py', bytes: bytes('print("a,b")\n'), description: 'The script that made the runs.', source: { method: 'script', code: 'print(1)', notes: 'run by hand' } })
  const rows = await s.writeDataset({ path: 'sim/rows.csv', bytes: bytes('a,b\n1,2\n'), description: 'One row per run.', derivedFrom: [gen.id], transform: 'Ran run.py.' })
  const rows2 = await s.writeDataset({ path: 'sim/rows2.csv', bytes: bytes('a,b\n3,4\n'), derivedFrom: [gen.id] })
  const notes = await s.writeDataset({ path: 'sim/notes.md', bytes: bytes('# Notes\n') })
  const secretSrc = await s.writeDataset({ path: 'secret/src.txt', bytes: bytes('secret source') })
  const secret = await s.writeDataset({ path: 'secret/rows.csv', bytes: bytes('x\nsecret\n'), derivedFrom: [secretSrc.id] })
  ids = { gen: gen.id, rows: rows.id, rows2: rows2.id, notes: notes.id, secret: secret.id, secretSrc: secretSrc.id }
  const html = '<script type="module">const rows = await prolifica.data("rows")</script>'
  const slots = { rows: { kind: 'csv' as const, description: 'one row per run: a, b' }, notes: { kind: 'markdown' as const } }
  pub = (await s.publishIsle({ html, title: 'Runs <b>', description: 'What the runs show.', slots, bindings: { rows: rows.id, notes: notes.id }, instructions: '# Use\nRebind rows with any a,b csv.', visibility: 'public' })).isle.id
  await s.publishIsle({ id: pub, bindings: { rows: rows2.id }, instructions: 'Version two notes.', note: 'new runs' })
  unlisted = (await s.publishIsle({ html, title: 'Unlisted runs', slots, bindings: { rows: rows.id }, visibility: 'unlisted' })).isle.id
  priv = (await s.publishIsle({ html, title: 'Secret runs', slots, bindings: { rows: secret.id }, visibility: 'private' })).isle.id
})

describe('GET /api/isles/:id/data', () => {
  it('lists each slot with its addresses, and the data it was made from', async () => {
    const res = await get(`/api/isles/${pub}/data`)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const d = (await res.json()) as IsleData
    expect(d.isle).toMatchObject({ id: pub, version: 2, latest: 2, owner: { handle: 'alice' }, instructions: 'Version two notes.' })
    expect(d.isle.links.markdown).toBe(`${APP}/i/${pub}.md`)
    const rows = d.slots.find((s) => s.slot === 'rows')!
    expect(rows).toMatchObject({ kind: 'csv', slotDescription: 'one row per run: a, b', url: `${APP}/api/isles/${pub}/data/rows` })
    expect(rows.dataset).toMatchObject({ id: ids.rows2, path: 'sim/rows2.csv', contentType: 'text/csv', derivedFrom: [ids.gen] })
    // bound data went public with the isle
    expect(rows.dataset!.raw).toBe(`${APP}/api/data/${ids.rows2}/raw`)
    expect(d.sources).toHaveLength(1)
    expect(d.sources[0]).toMatchObject({ id: ids.gen, path: 'sim/run.py', feeds: ['rows'], raw: `${APP}/api/data/${ids.gen}/raw` })
    expect(d.sources[0]!.source).toMatchObject({ method: 'script', notes: 'run by hand', code: `${APP}/api/data/${ids.gen}/collector` })
    // the source went public with the isle, so its own address works without sign-in
    expect(await (await get(`/api/data/${ids.gen}/raw`)).text()).toBe('print("a,b")\n')
  })

  it('resolves an older version with its own bindings and instructions', async () => {
    const d = (await (await get(`/api/isles/${pub}/data?v=1`)).json()) as IsleData
    expect(d.isle).toMatchObject({ version: 1, latest: 2, instructions: '# Use\nRebind rows with any a,b csv.' })
    expect(d.slots.find((s) => s.slot === 'rows')).toMatchObject({ dataset: { id: ids.rows }, url: `${APP}/api/isles/${pub}/data/rows?v=1` })
    expect(await (await get(`/api/isles/${pub}/data/rows?v=1`)).text()).toBe('a,b\n1,2\n')
    expect(await (await get(`/api/isles/${pub}/data/rows`)).text()).toBe('a,b\n3,4\n')
    for (const v of ['3', '0', 'abc', '1.5']) expect((await get(`/api/isles/${pub}/data?v=${v}`)).status).toBe(404)
  })

  it('shows bound data that its owner made private only through the isle', async () => {
    await as(alice).updateDatasetMeta(ids.rows2, { public: false })
    const rows = ((await (await get(`/api/isles/${pub}/data`)).json()) as IsleData).slots.find((s) => s.slot === 'rows')!
    expect(rows.dataset).toMatchObject({ id: ids.rows2, raw: null, transform: null, source: null })
    expect((await get(`/api/data/${ids.rows2}/raw`)).status).toBe(404)
    expect(await (await get(`/api/isles/${pub}/data/rows`)).text()).toBe('a,b\n3,4\n')
    const isle = (await (await get(`/api/isles/${pub}`)).json()) as { bindings: Record<string, { url: string; raw: string | null }> }
    expect(isle.bindings.rows).toMatchObject({ url: `${APP}/api/isles/${pub}/data/rows`, raw: null })
  })

  it('leaves out a source its owner made private again', async () => {
    await as(alice).updateDatasetMeta(ids.gen, { public: false })
    const anon = (await (await get(`/api/isles/${pub}/data`)).json()) as IsleData
    expect(anon.sources).toEqual([])
    expect(anon.slots.find((s) => s.slot === 'rows')!.dataset!.derivedFrom).toEqual([])
    expect(JSON.stringify(anon)).not.toContain(ids.gen)
    // the owner still sees it, and that answer is not open to other sites
    const res = await signedIn(`/api/isles/${pub}/data`)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(((await res.json()) as IsleData).sources.map((s) => s.id)).toEqual([ids.gen])
  })
})

describe('GET /api/isles/:id/data/:slot', () => {
  it('serves the content so that it cannot run as a page', async () => {
    const res = await get(`/api/isles/${pub}/data/notes`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.text()).toBe('# Notes\n')
  })
  it('404s for an unbound or unknown slot', async () => {
    expect((await get(`/api/isles/${pub}/data/nope`)).status).toBe(404)
    expect((await get(`/api/isles/${pub}/data/__proto__`)).status).toBe(404)
  })
})

describe('private and unlisted isles', () => {
  it('never shows a private isle or its data without its owner', async () => {
    for (const path of [`/api/isles/${priv}`, `/api/isles/${priv}/data`, `/api/isles/${priv}/data/rows`, `/i/${priv}.md`, `/api/data/${ids.secret}/raw`, `/api/data/${ids.secretSrc}/raw`]) {
      const res = await get(path)
      expect(res.status, path).toBe(404)
      expect(res.headers.get('access-control-allow-origin'), path).toBeNull()
      expect(await res.text(), path).not.toContain('secret')
    }
  })
  it('shows a private isle to its owner, never open to other sites', async () => {
    for (const path of [`/api/isles/${priv}`, `/api/isles/${priv}/data`, `/api/isles/${priv}/data/rows`, `/i/${priv}.md`]) {
      const res = await signedIn(path)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('access-control-allow-origin'), path).toBeNull()
      expect(res.headers.get('cache-control'), path).toMatch(/private/)
    }
    const d = (await (await signedIn(`/api/isles/${priv}/data`)).json()) as IsleData
    expect(d.isle.links.live).toBeNull()
    expect(d.sources.map((s) => s.id)).toEqual([ids.secretSrc])
  })
  it('opens an unlisted isle to anyone with its address, and keeps it out of search engines', async () => {
    const res = await get(`/i/${unlisted}.md`)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(await res.text()).toContain(`${APP}/api/isles/${unlisted}/data/rows`)
    expect(await (await get(`/api/isles/${unlisted}/data/rows`)).text()).toBe('a,b\n1,2\n')
    const shell = isleShellParts((await (await get(`/api/isles/${unlisted}/data`)).json()) as IsleData)
    expect(shell.head).toContain('<meta name="robots" content="noindex">')
  })
  it('does not list a private isle that a public one was remixed from', async () => {
    const child = (await as(alice).publishIsle({ parent: priv, from: priv, title: 'Child', bindings: { rows: ids.rows }, visibility: 'public' })).isle.id
    const d = (await (await get(`/api/isles/${child}/data`)).json()) as IsleData
    expect(d.isle.parentId).toBeNull()
    expect(d.isle.links.parent).toBeNull()
    expect(await (await get(`/i/${child}.md`)).text()).not.toContain(priv)
  })
})

describe('GET /api/isles/:id', () => {
  it('gives each binding its addresses, open to other sites without sign-in', async () => {
    const res = await get(`/api/isles/${pub}`)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const isle = (await res.json()) as { bindings: Record<string, { url: string; raw: string | null }>; links: { markdown: string } }
    expect(isle.bindings.rows).toMatchObject({ url: `${APP}/api/isles/${pub}/data/rows`, raw: `${APP}/api/data/${ids.rows2}/raw` })
    expect(isle.links.markdown).toBe(`${APP}/i/${pub}.md`)
    expect((await signedIn(`/api/isles/${pub}`)).headers.get('access-control-allow-origin')).toBeNull()
  })
  it('opens public raw data only', async () => {
    await as(alice).updateDatasetMeta(ids.notes, { public: true })
    expect((await get(`/api/data/${ids.notes}/raw`)).headers.get('access-control-allow-origin')).toBe('*')
    expect((await signedIn(`/api/data/${ids.notes}/raw`)).headers.get('access-control-allow-origin')).toBeNull()
    expect((await signedIn(`/api/data/${ids.secret}/raw`)).headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('GET /i/:id.md', () => {
  it('has the title, instructions, data addresses, sources and how to read data', async () => {
    const res = await get(`/i/${pub}.md`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const md = await res.text()
    expect(md).toMatch(/^# Runs <b>\n/)
    expect(md).toContain('by @alice, version 2, public')
    expect(md).toContain('Version two notes.')
    expect(md).toContain(`- Content: ${APP}/api/isles/${pub}/data/rows`)
    expect(md).toContain(`- Page HTML as the author wrote it (read it to see how the page uses the data): ${APP}/api/isles/${pub}/source`)
    expect(md).toContain(`- Raw dataset: ${APP}/api/data/${ids.gen}/raw`)
    expect(md).toContain('prolifica.data("<slot>")')
    const v1 = await (await get(`/i/${pub}.md?v=1`)).text()
    expect(v1).toContain('version 1 (the latest is 2)')
    expect(v1).toContain('## Use') // the author's heading goes one level down
    expect((await get(`/i/${pub}.json.md`)).status).toBe(404)
    expect((await get(`/i/nosuchisle.md`)).status).toBe(404)
  })
})

describe('GET /llms.txt', () => {
  it('describes the addresses, open to any site', async () => {
    const res = await get('/llms.txt')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const text = await res.text()
    expect(text).toMatch(/^# Prolifica\n\n> /)
    for (const s of [`${APP}/i/<id>.md`, `${APP}/api/isles/<id>/data`, `${APP}/mcp`]) expect(text).toContain(s)
  })
  it('names the origins it is given', () => {
    expect(llmsTxt('http://localhost:5190', 'http://127.0.0.1:5190')).toContain('http://127.0.0.1:5190/<id>')
  })
})

describe('isleShellParts and isleMarkdown', () => {
  it('escapes what the author wrote', async () => {
    const d = (await (await get(`/api/isles/${pub}/data`)).json()) as IsleData
    d.isle.title = '</h1><script>alert(1)</script>'
    d.slots[0]!.slot = '"><img src=x onerror=alert(1)>'
    const { head, body } = isleShellParts(d)
    expect(head).toContain(`<link rel="alternate" type="text/markdown" href="${APP}/i/${pub}.md">`)
    expect(body).not.toContain('<script>')
    expect(body).not.toContain('<img')
    expect(body).toMatch(/^<div class="pf-plain">/)
  })
  it('keeps text that is not code inside its code spans', async () => {
    const d = (await (await get(`/api/isles/${pub}/data`)).json()) as IsleData
    d.slots[0]!.dataset!.path = 'a`b'
    d.slots[0]!.slotDescription = 'one\n# not a heading'
    const md = isleMarkdown(d, `${APP}/mcp`)
    expect(md).toContain('`` a`b ``')
    expect(md).toContain('- What the page expects: one # not a heading')
  })
})

describe('paths that are not pages', () => {
  const SHELL = '<!doctype html><html><head></head><body><div id="root"></div></body></html>'
  // like the assets binding with not_found_handling: single-page-application
  const assets = {
    fetch: async (r: Request) =>
      new URL(r.url).pathname === '/favicon.svg' ? new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }) : new Response(SHELL, { headers: { 'content-type': 'text/html' } }),
  }
  const asset = (path: string) => assetOr404(new Request(`${APP}${path}`), { ASSETS: assets } as unknown as Env)

  it('takes file names at the root and under /i/, not app pages', () => {
    for (const p of ['/AGENTS.md', '/x.json', '/robots.txt', '/favicon.svg', '/i/abc.txt']) expect(looksLikeFile(p), p).toBe(true)
    for (const p of ['/', '/map', '/i/abc123', '/i/abc123/family', '/s/example.com', '/@alice', '/d/abc']) expect(looksLikeFile(p), p).toBe(false)
  })
  it('404s a file that is not there, and serves one that is', async () => {
    for (const p of ['/AGENTS.md', '/x.json', '/robots.txt']) {
      const res = await asset(p)
      expect(res.status, p).toBe(404)
      expect(await res.text()).toContain('/llms.txt')
    }
    expect((await asset('/favicon.svg')).status).toBe(200)
    expect(await (await asset('/index.html')).text()).toBe(SHELL)
  })
})
