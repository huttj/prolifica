import { classifyRelation, pageSimilarity, type Relation } from '../shared/relation'
import { siteOf } from '../shared/site'
import { COLLECTION_METHODS, type SeaChart, type SiteCollector, type SiteDataset, type SiteInfo, type SiteSummary } from '../shared/types'
import type {
  Anchor, AnchorState, CollectionMethod, DataKind, DataSource, Dataset, DatasetRef, Isle, IsleSummary, LibraryItem, Lineage, Mark, MarkKind, Person, SlotSpec, TreeNode, Visibility,
} from '../shared/types'
import { islesOrigin, quotaFor, signIsle } from './auth'
import { Db, sha256Hex, shortId, toPerson, type UserRow } from './db'

/** Data, isles, the lineage graph and marks. Shared by the REST API and the MCP tools, so both obey the same rules. */

/** Keep a mark's view state small and well-formed; anything else is dropped rather than stored. */
function cleanState(v: unknown): AnchorState | undefined {
  if (!v || typeof v !== 'object') return undefined
  const st = v as AnchorState
  const out: AnchorState = {}
  if (typeof st.hash === 'string' && st.hash.startsWith('#')) out.hash = st.hash.slice(0, 500)
  if (st.app !== undefined) {
    try {
      if (JSON.stringify(st.app).length <= 3000) out.app = st.app
    } catch {
      /* not JSON-able */
    }
  }
  if (Array.isArray(st.trail))
    out.trail = st.trail
      .filter((t) => t && typeof t.sel === 'string')
      .slice(-8)
      .map((t) => (typeof t.value === 'string' ? { sel: t.sel.slice(0, 300), value: t.value.slice(0, 200) } : { sel: t.sel.slice(0, 300) }))
  return Object.keys(out).length ? out : undefined
}

/** The app's URL for an isle's picture; the version in it changes when a newer picture exists. */
export const shotUrl = (row: Pick<IsleRow, 'id' | 'shot_version'>) => `/api/isles/${row.id}/shot?v=${row.shot_version ?? 0}`

export class StoreError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const fail = (status: number, message: string): never => {
  throw new StoreError(status, message)
}

export const MAX_HTML_BYTES = 1024 * 1024
export const MAX_SNIPPET = 8 * 1024
export const MAX_COMMENT = 4000

interface DatasetRow {
  id: string
  owner_id: string
  path: string
  kind: DataKind
  content_type: string
  blob: string
  size: number
  description: string | null
  transform: string | null
  public: number
  source_url: string | null
  source_method: CollectionMethod | null
  source_notes: string | null
  collected_at: number | null
  source_code: string | null
  source_code_lang: string | null
  source_site: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface IsleRow {
  id: string
  owner_id: string
  title: string
  description: string | null
  source_blob: string
  slots: string
  bindings: string
  parent_id: string | null
  relation: Relation | null
  visibility: Visibility
  version: number
  note: string | null
  star_count: number
  created_at: number
  updated_at: number
  deleted_at: number | null
  shot_version: number | null
  shot_at: number | null
}

interface MarkRow {
  id: string
  user_id: string
  isle_id: string
  anchor_key: string
  anchor: string | null
  snippet: string | null
  kind: MarkKind
  emoji: string | null
  body: string | null
  parent_id: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface PublishInput {
  id?: string
  html?: string
  from?: string
  title?: string
  description?: string | null
  slots?: Record<string, SlotSpec>
  bindings?: Record<string, string>
  parent?: string
  uses?: { isle: string; selector?: string; label?: string }[]
  visibility?: Visibility
  note?: string
  /** what the publisher says changed in the page: 'same' view (adapted to new data, small fixes) or a 'new' one */
  view?: 'same' | 'new'
  /** internal: put back a page this isle had before (restoring a version) */
  sourceBlob?: string
}

export interface WriteDataInput {
  id?: string
  path: string
  bytes: Uint8Array<ArrayBuffer>
  contentType?: string
  description?: string | null
  transform?: string | null
  derivedFrom?: string[]
  public?: boolean
  source?: SourceInput
}

/** Provenance to set: a field left out keeps what was there; null clears it. */
export interface SourceInput {
  url?: string | null
  method?: string | null
  notes?: string | null
  collectedAt?: number | string | null
  code?: string | null
  codeLanguage?: string | null
}

export const MAX_COLLECTOR_CODE = 200 * 1024

export interface Tally {
  anchorKey: string
  anchor: Anchor | null
  stars: number
  starredByMe: boolean
  comments: number
}

export type Layer = 'mine' | 'author' | 'following' | 'everyone'

const EXT_TYPES: Record<string, string> = {
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', geojson: 'application/geo+json',
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', html: 'text/html',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
}

export function contentTypeFor(path: string, given?: string): string {
  if (given && given !== 'application/octet-stream') return given.split(';')[0]!.trim().toLowerCase()
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TYPES[ext] ?? given ?? 'application/octet-stream'
}

export function kindFor(contentType: string): DataKind {
  if (contentType === 'text/csv' || contentType === 'text/tab-separated-values') return 'csv'
  if (contentType === 'application/json' || contentType.endsWith('+json')) return 'json'
  if (contentType === 'text/markdown') return 'markdown'
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('text/')) return 'text'
  return 'binary'
}

export function normalizePath(path: string): string {
  const clean = path
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/')
  if (!clean) fail(400, 'A path is required, like "tweets/2024.csv"')
  if (clean.length > 200) fail(400, 'That path is too long (200 characters at most)')
  return clean
}

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function anchorKeyOf(anchor: Anchor | null | undefined) {
  return anchor?.selector?.trim() ?? ''
}

export class Store {
  private db: Db
  private people = new Map<string, Person>()

  constructor(private env: Env, private request: Request, public viewer: UserRow | null) {
    this.db = new Db(env.DB)
    if (viewer) this.people.set(viewer.id, toPerson(viewer))
  }

  private get d1() {
    return this.env.DB
  }

  private requireViewer(): UserRow {
    return this.viewer ?? fail(401, 'Sign in first')
  }

  private async persons(ids: string[]): Promise<Map<string, Person>> {
    const missing = ids.filter((id) => !this.people.has(id))
    if (missing.length) {
      const rows = await this.db.usersByIds(missing)
      for (const [id, u] of rows) this.people.set(id, toPerson(u))
    }
    return this.people
  }

  private person(id: string): Person {
    return this.people.get(id) ?? { id, handle: null, name: null, bio: null }
  }

  // ---- blobs and quota ----

  async putBlob(bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<string> {
    const hash = await sha256Hex(bytes)
    const known = await this.d1.prepare('SELECT 1 AS x FROM blobs WHERE hash = ?').bind(hash).first()
    if (!known) {
      await this.env.BLOBS.put(`blobs/${hash}`, bytes, { httpMetadata: { contentType } })
      await this.d1.prepare('INSERT OR IGNORE INTO blobs (hash, size, content_type, created_at) VALUES (?, ?, ?, ?)').bind(hash, bytes.byteLength, contentType, Date.now()).run()
    }
    return hash
  }

  getBlob(hash: string) {
    return this.env.BLOBS.get(`blobs/${hash}`)
  }

  async blobText(hash: string): Promise<string> {
    const obj = await this.getBlob(hash)
    return obj ? await obj.text() : ''
  }

  /** Bytes a person holds: the distinct blobs their data and isles (with past versions) point at. */
  async usage(userId: string, except?: { dataset?: string }): Promise<{ bytes: number; hashes: Set<string> }> {
    const { results } = await this.d1
      .prepare(
        `SELECT b.hash, b.size FROM blobs b WHERE b.hash IN (
           SELECT blob FROM datasets WHERE owner_id = ?1 AND deleted_at IS NULL AND id != ?2
           UNION SELECT source_blob FROM isles WHERE owner_id = ?1 AND deleted_at IS NULL
           UNION SELECT source_blob FROM isle_versions WHERE owner_id = ?1)`,
      )
      .bind(userId, except?.dataset ?? '')
      .all<{ hash: string; size: number }>()
    return { bytes: results.reduce((s, r) => s + r.size, 0), hashes: new Set(results.map((r) => r.hash)) }
  }

  private async checkQuota(userId: string, hash: string, size: number, except?: { dataset?: string }) {
    const { bytes, hashes } = await this.usage(userId, except)
    if (hashes.has(hash)) return
    const limit = quotaFor(this.env, (await this.db.userById(userId)) ?? { email: '' })
    if (!Number.isFinite(limit)) return
    if (bytes + size > limit) {
      fail(413, `That needs ${fmtBytes(size)} and you have ${fmtBytes(Math.max(0, limit - bytes))} of your ${fmtBytes(limit)} left. Delete some data or old isles to make room.`)
    }
  }

  // ---- data ----

  private async datasetRow(id: string): Promise<DatasetRow | null> {
    return this.d1.prepare('SELECT * FROM datasets WHERE id = ? AND deleted_at IS NULL').bind(id).first<DatasetRow>()
  }

  private canReadDataset(row: DatasetRow) {
    return !!row.public || row.owner_id === this.viewer?.id
  }

  private async toDatasetRef(row: DatasetRow): Promise<DatasetRef> {
    await this.persons([row.owner_id])
    return { id: row.id, path: row.path, kind: row.kind, owner: this.person(row.owner_id) }
  }

  private async toDataset(row: DatasetRow): Promise<Dataset> {
    const { results } = await this.d1
      .prepare(`SELECT d.* FROM edges e JOIN datasets d ON d.id = e.dst_id WHERE e.src_kind = 'dataset' AND e.src_id = ? AND e.rel = 'derived' AND d.deleted_at IS NULL`)
      .bind(row.id)
      .all<DatasetRow>()
    await this.persons([row.owner_id, ...results.map((r) => r.owner_id)])
    return {
      ...(await this.toDatasetRef(row)),
      contentType: row.content_type,
      size: row.size,
      description: row.description,
      transform: row.transform,
      public: !!row.public,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      derivedFrom: await Promise.all(results.filter((r) => this.canReadDataset(r)).map((r) => this.toDatasetRef(r))),
      source: await this.sourceOf(row),
    }
  }

  private async sourceOf(row: DatasetRow): Promise<DataSource | null> {
    if (!row.source_url && !row.source_method && !row.source_notes && !row.collected_at && !row.source_code) return null
    let code: DataSource['code'] = null
    if (row.source_code) {
      const b = await this.d1.prepare('SELECT size FROM blobs WHERE hash = ?').bind(row.source_code).first<{ size: number }>()
      code = { hash: row.source_code, size: b?.size ?? 0, language: row.source_code_lang }
    }
    return { url: row.source_url, method: row.source_method, notes: row.source_notes, collectedAt: row.collected_at, code }
  }

  /** Column updates for a provenance patch (code goes into a blob first). */
  private async sourceColumns(input: SourceInput | undefined): Promise<Record<string, unknown>> {
    if (!input) return {}
    const cols: Record<string, unknown> = {}
    const text = (v: string | null | undefined, max: number) => (v === undefined ? undefined : v === null ? null : v.trim().slice(0, max) || null)
    if (input.url !== undefined) {
      const url = text(input.url, 2000)
      if (url && !/^https?:\/\//i.test(url) && !/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url)) fail(400, 'source url should be a web address (https://…)')
      cols.source_url = url && !/^https?:/i.test(url) ? `https://${url}` : url
      cols.source_site = siteOf(cols.source_url as string | null)
    }
    if (input.method !== undefined) {
      if (input.method !== null && !(input.method in COLLECTION_METHODS)) fail(400, `method is one of: ${Object.keys(COLLECTION_METHODS).join(', ')}`)
      cols.source_method = input.method
    }
    if (input.notes !== undefined) cols.source_notes = text(input.notes, 4000)
    if (input.collectedAt !== undefined) {
      const t = input.collectedAt === null ? null : typeof input.collectedAt === 'number' ? input.collectedAt : Date.parse(input.collectedAt)
      if (t !== null && !Number.isFinite(t)) fail(400, 'collected_at should be a date, like 2026-10-07')
      cols.collected_at = t
    }
    if (input.code !== undefined) {
      if (input.code === null || !input.code.trim()) cols.source_code = null
      else {
        const bytes = new TextEncoder().encode(input.code)
        if (bytes.byteLength > MAX_COLLECTOR_CODE) fail(413, `Collector code can be ${fmtBytes(MAX_COLLECTOR_CODE)} at most`)
        cols.source_code = await this.putBlob(bytes, 'text/plain; charset=utf-8')
      }
    }
    if (input.codeLanguage !== undefined) cols.source_code_lang = text(input.codeLanguage, 40)
    return cols
  }

  private async applySource(id: string, input: SourceInput | undefined) {
    const cols = await this.sourceColumns(input)
    const keys = Object.keys(cols)
    if (!keys.length) return
    await this.d1.prepare(`UPDATE datasets SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...keys.map((k) => cols[k]), id).run()
  }

  /** The collector code a dataset was gathered with. */
  async collectorCode(id: string): Promise<string | null> {
    const { row } = await this.getDataset(id)
    return row.source_code ? this.blobText(row.source_code) : null
  }

  /** Other data gathered with the very same collector code. */
  async sameCollector(id: string): Promise<DatasetRef[]> {
    const { row } = await this.getDataset(id)
    if (!row.source_code) return []
    const { results } = await this.d1
      .prepare('SELECT * FROM datasets WHERE source_code = ? AND id != ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50')
      .bind(row.source_code, id)
      .all<DatasetRow>()
    return Promise.all(results.filter((r) => this.canReadDataset(r)).map((r) => this.toDatasetRef(r)))
  }

  async getDataset(id: string): Promise<{ dataset: Dataset; row: DatasetRow }> {
    const row = await this.datasetRow(id)
    if (!row || !this.canReadDataset(row)) fail(404, `No data with id ${id} that you can see`)
    return { dataset: await this.toDataset(row!), row: row! }
  }

  async listDatasets(opts: { ownerId?: string; folder?: string; limit?: number } = {}): Promise<Dataset[]> {
    const ownerId = opts.ownerId ?? this.requireViewer().id
    const mine = ownerId === this.viewer?.id
    const folder = opts.folder ? normalizePath(opts.folder) + '/' : ''
    const { results } = await this.d1
      .prepare(
        `SELECT * FROM datasets WHERE owner_id = ? AND deleted_at IS NULL ${mine ? '' : 'AND public = 1'}
         AND substr(path, 1, ?) = ? ORDER BY path LIMIT ?`,
      )
      .bind(ownerId, folder.length, folder, Math.min(opts.limit ?? 500, 1000))
      .all<DatasetRow>()
    return Promise.all(results.map((r) => this.toDataset(r)))
  }

  async writeDataset(input: WriteDataInput): Promise<Dataset> {
    const me = this.requireViewer()
    const path = normalizePath(input.path)
    let existing: DatasetRow | null = null
    if (input.id) {
      existing = await this.datasetRow(input.id)
      if (!existing || existing.owner_id !== me.id) fail(404, `You have no data with id ${input.id}`)
    } else {
      existing = await this.d1.prepare('SELECT * FROM datasets WHERE owner_id = ? AND path = ? AND deleted_at IS NULL').bind(me.id, path).first<DatasetRow>()
    }
    const contentType = contentTypeFor(path, input.contentType ?? existing?.content_type)
    const hash = await sha256Hex(input.bytes)
    await this.checkQuota(me.id, hash, input.bytes.byteLength, existing ? { dataset: existing.id } : undefined)
    await this.putBlob(input.bytes, contentType)

    const parents: DatasetRow[] = []
    for (const pid of input.derivedFrom ?? []) {
      const p = await this.datasetRow(pid)
      if (!p || !this.canReadDataset(p)) fail(400, `derived_from: no data with id ${pid} that you can see`)
      parents.push(p!)
    }

    const now = Date.now()
    const id = existing?.id ?? shortId()
    const isPublic = input.public ?? !!existing?.public
    if (existing) {
      if (path !== existing.path) {
        const clash = await this.d1.prepare('SELECT id FROM datasets WHERE owner_id = ? AND path = ? AND deleted_at IS NULL AND id != ?').bind(me.id, path, id).first()
        if (clash) fail(409, `You already have data at ${path}`)
      }
      await this.d1
        .prepare(
          `UPDATE datasets SET path = ?, kind = ?, content_type = ?, blob = ?, size = ?, description = COALESCE(?, description),
           transform = COALESCE(?, transform), public = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(path, kindFor(contentType), contentType, hash, input.bytes.byteLength, input.description ?? null, input.transform ?? null, isPublic ? 1 : 0, now, id)
        .run()
    } else {
      await this.d1
        .prepare(
          `INSERT INTO datasets (id, owner_id, path, kind, content_type, blob, size, description, transform, public, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, me.id, path, kindFor(contentType), contentType, hash, input.bytes.byteLength, input.description ?? null, input.transform ?? null, isPublic ? 1 : 0, now, now)
        .run()
    }
    await this.applySource(id, input.source)
    if (input.derivedFrom) {
      await this.d1.batch([
        this.d1.prepare(`DELETE FROM edges WHERE src_kind = 'dataset' AND src_id = ? AND rel = 'derived'`).bind(id),
        ...parents.map((p) =>
          this.d1.prepare(`INSERT OR IGNORE INTO edges (src_kind, src_id, rel, dst_kind, dst_id, created_at) VALUES ('dataset', ?, 'derived', 'dataset', ?, ?)`).bind(id, p.id, now),
        ),
      ])
    }
    return (await this.getDataset(id)).dataset
  }

  async updateDatasetMeta(id: string, patch: { path?: string; description?: string | null; public?: boolean; source?: SourceInput }): Promise<Dataset> {
    const me = this.requireViewer()
    const row = await this.datasetRow(id)
    if (!row || row.owner_id !== me.id) fail(404, `You have no data with id ${id}`)
    const path = patch.path !== undefined ? normalizePath(patch.path) : row!.path
    try {
      await this.d1
        .prepare('UPDATE datasets SET path = ?, description = ?, public = ?, updated_at = ? WHERE id = ?')
        .bind(path, patch.description !== undefined ? patch.description : row!.description, patch.public !== undefined ? (patch.public ? 1 : 0) : row!.public, Date.now(), id)
        .run()
    } catch (e) {
      if (String(e).includes('UNIQUE')) fail(409, `You already have data at ${path}`)
      throw e
    }
    await this.applySource(id, patch.source)
    return (await this.getDataset(id)).dataset
  }

  async deleteDataset(id: string) {
    const me = this.requireViewer()
    const row = await this.datasetRow(id)
    if (!row || row.owner_id !== me.id) fail(404, `You have no data with id ${id}`)
    const { results } = await this.d1
      .prepare(`SELECT i.id, i.title FROM edges e JOIN isles i ON i.id = e.src_id WHERE e.rel = 'binds' AND e.dst_id = ? AND i.deleted_at IS NULL LIMIT 10`)
      .bind(id)
      .all<{ id: string; title: string }>()
    if (results.length) {
      fail(409, `Isles still show this data: ${results.map((r) => `"${r.title}" (${r.id})`).join(', ')}. Rebind or delete them first.`)
    }
    await this.d1.prepare('UPDATE datasets SET deleted_at = ? WHERE id = ?').bind(Date.now(), id).run()
  }

  // ---- sites: where data comes from ----

  /** Sites that data has come from, busiest first. Only data the viewer can see counts. */
  async sites(limit = 200): Promise<SiteSummary[]> {
    const { results } = await this.d1
      .prepare(
        `SELECT source_site AS site, COUNT(*) AS datasets, COUNT(DISTINCT source_code) AS collectors, COUNT(DISTINCT owner_id) AS people, MAX(updated_at) AS lastUsed
         FROM datasets WHERE source_site IS NOT NULL AND deleted_at IS NULL AND (public = 1 OR owner_id = ?)
         GROUP BY source_site ORDER BY datasets DESC, lastUsed DESC LIMIT ?`,
      )
      .bind(this.viewer?.id ?? '', limit)
      .all<SiteSummary>()
    return results
  }

  /** How data has been collected from one site, the data that came from it, and the isles that show it. */
  async site(siteOrUrl: string): Promise<SiteInfo> {
    const site = siteOf(siteOrUrl) ?? fail(400, `"${siteOrUrl}" is not a site or web address`)
    const { results } = await this.d1
      .prepare(`SELECT * FROM datasets WHERE source_site = ? AND deleted_at IS NULL AND (public = 1 OR owner_id = ?) ORDER BY updated_at DESC LIMIT 500`)
      .bind(site, this.viewer?.id ?? '')
      .all<DatasetRow>()
    await this.persons(results.map((r) => r.owner_id))

    const datasets: SiteDataset[] = []
    const methods: SiteInfo['methods'] = {}
    const byCode = new Map<string, DatasetRow[]>()
    for (const r of results) {
      datasets.push({
        ...(await this.toDatasetRef(r)),
        size: r.size, description: r.description, method: r.source_method, url: r.source_url, collectedAt: r.collected_at, updatedAt: r.updated_at,
      })
      if (r.source_method) methods[r.source_method] = (methods[r.source_method] ?? 0) + 1
      if (r.source_code) byCode.set(r.source_code, [...(byCode.get(r.source_code) ?? []), r])
    }

    const sizes = new Map<string, number>()
    const hashes = [...byCode.keys()]
    for (let i = 0; i < hashes.length; i += 50) {
      const chunk = hashes.slice(i, i + 50)
      const { results: b } = await this.d1.prepare(`SELECT hash, size FROM blobs WHERE hash IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<{ hash: string; size: number }>()
      for (const x of b) sizes.set(x.hash, x.size)
    }
    const collectors: SiteCollector[] = []
    for (const [hash, rows] of byCode) {
      collectors.push({
        hash,
        language: rows.find((r) => r.source_code_lang)?.source_code_lang ?? null,
        size: sizes.get(hash) ?? 0,
        methods: [...new Set(rows.map((r) => r.source_method).filter((m): m is CollectionMethod => !!m))],
        uses: rows.length,
        people: new Set(rows.map((r) => r.owner_id)).size,
        lastUsed: Math.max(...rows.map((r) => r.updated_at)),
        notes: [...new Set(rows.map((r) => r.source_notes?.trim()).filter((n): n is string => !!n))].slice(0, 3),
        example: await this.toDatasetRef(rows[0]!),
      })
    }
    // the collector most people trust first, then the most used, then the freshest
    collectors.sort((a, b) => b.people - a.people || b.uses - a.uses || b.lastUsed - a.lastUsed)

    const ids = results.map((r) => r.id)
    const isles: IsleSummary[] = []
    for (let i = 0; i < ids.length && isles.length < 60; i += 50) {
      const chunk = ids.slice(i, i + 50)
      const { results: rows } = await this.d1
        .prepare(
          `SELECT DISTINCT i.* FROM edges e JOIN isles i ON i.id = e.src_id
           WHERE e.rel = 'binds' AND e.dst_kind = 'dataset' AND e.dst_id IN (${chunk.map(() => '?').join(',')}) AND i.deleted_at IS NULL`,
        )
        .bind(...chunk)
        .all<IsleRow>()
      for (const r of rows) if (this.canSeeIsle(r) && !isles.some((x) => x.id === r.id)) isles.push(await this.toSummary(r))
    }
    isles.sort((a, b) => b.starCount - a.starCount || b.updatedAt - a.updatedAt)
    return { site, datasets, collectors, methods, isles }
  }

  /** One collector's code, if the viewer can see some data it gathered. */
  async collectorByHash(hash: string): Promise<string> {
    const row = await this.d1
      .prepare('SELECT 1 AS x FROM datasets WHERE source_code = ? AND deleted_at IS NULL AND (public = 1 OR owner_id = ?) LIMIT 1')
      .bind(hash, this.viewer?.id ?? '')
      .first()
    if (!row) fail(404, 'No such collector')
    return this.blobText(hash)
  }

  // ---- isles ----

  async frameUrl(row: Pick<IsleRow, 'id' | 'version' | 'visibility'>) {
    const base = `${islesOrigin(this.request, this.env)}/${row.id}?v=${row.version}`
    return row.visibility === 'private' ? `${base}&g=${encodeURIComponent(await signIsle(this.env, row.id))}` : base
  }

  canSeeIsle(row: IsleRow) {
    return row.visibility !== 'private' || row.owner_id === this.viewer?.id
  }

  async isleRow(id: string): Promise<IsleRow | null> {
    return this.d1.prepare('SELECT * FROM isles WHERE id = ? AND deleted_at IS NULL').bind(id).first<IsleRow>()
  }

  async visibleIsleRow(id: string): Promise<IsleRow> {
    const row = await this.isleRow(id)
    if (!row || !this.canSeeIsle(row)) fail(404, `No isle with id ${id} that you can see`)
    return row!
  }

  async toSummary(row: IsleRow): Promise<IsleSummary> {
    await this.persons([row.owner_id])
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      owner: this.person(row.owner_id),
      visibility: row.visibility,
      parentId: row.parent_id,
      relation: row.relation,
      starCount: row.star_count,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      frameUrl: await this.frameUrl(row),
      shotUrl: shotUrl(row),
    }
  }

  async getIsle(id: string): Promise<{ isle: Isle; row: IsleRow }> {
    const row = await this.visibleIsleRow(id)
    const bindings = parseJson<Record<string, string>>(row.bindings, {})
    const ids = Object.values(bindings)
    const dataRows = ids.length
      ? (
          await this.d1
            .prepare(`SELECT * FROM datasets WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`)
            .bind(...ids)
            .all<DatasetRow>()
        ).results
      : []
    const byId = new Map(dataRows.map((r) => [r.id, r]))
    const bound: Record<string, DatasetRef | null> = {}
    for (const [slot, did] of Object.entries(bindings)) {
      const d = byId.get(did)
      // data bound to an isle you can see is visible through it, even if private on its own
      bound[slot] = d ? await this.toDatasetRef(d) : null
    }
    const parentRow = row.parent_id ? await this.isleRow(row.parent_id) : null
    const childCount = (await this.d1.prepare('SELECT COUNT(*) AS n FROM isles WHERE parent_id = ? AND deleted_at IS NULL AND visibility != ?').bind(id, 'private').first<{ n: number }>())?.n ?? 0
    const { results: useRows } = await this.d1
      .prepare(`SELECT e.meta, i.* FROM edges e JOIN isles i ON i.id = e.dst_id WHERE e.src_kind = 'isle' AND e.src_id = ? AND e.rel = 'uses' AND i.deleted_at IS NULL`)
      .bind(id)
      .all<IsleRow & { meta: string | null }>()
    const uses = []
    for (const u of useRows) {
      if (!this.canSeeIsle(u)) continue
      const meta = parseJson<{ selector?: string; label?: string }>(u.meta, {})
      uses.push({ isle: await this.toSummary(u), selector: meta.selector ?? null, label: meta.label ?? null })
    }
    return {
      row,
      isle: {
        ...(await this.toSummary(row)),
        slots: parseJson(row.slots, {}),
        bindings: bound,
        parent: parentRow && this.canSeeIsle(parentRow) ? await this.toSummary(parentRow) : null,
        childCount,
        uses,
      },
    }
  }

  async isleSource(id: string): Promise<string> {
    const row = await this.visibleIsleRow(id)
    return this.blobText(row.source_blob)
  }

  async listIsles(opts: { ownerId?: string; q?: string; sort?: 'recent' | 'stars'; limit?: number; offset?: number } = {}): Promise<IsleSummary[]> {
    const where = ['deleted_at IS NULL']
    const args: unknown[] = []
    if (opts.ownerId) {
      where.push('owner_id = ?')
      args.push(opts.ownerId)
      if (opts.ownerId !== this.viewer?.id) where.push(`visibility = 'public'`)
    } else where.push(`visibility = 'public'`)
    const q = opts.q?.trim().toLowerCase().replace(/[%_]/g, '')
    if (q) {
      where.push('(lower(title) LIKE ? OR lower(description) LIKE ?)')
      args.push(`%${q}%`, `%${q}%`)
    }
    const order = opts.sort === 'stars' ? 'star_count DESC, updated_at DESC' : 'updated_at DESC'
    const { results } = await this.d1
      .prepare(`SELECT * FROM isles WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...args, Math.min(opts.limit ?? 40, 200), opts.offset ?? 0)
      .all<IsleRow>()
    await this.persons(results.map((r) => r.owner_id))
    return Promise.all(results.map((r) => this.toSummary(r)))
  }

  async publishIsle(input: PublishInput): Promise<{ isle: Isle; madePublic: DatasetRef[] }> {
    const me = this.requireViewer()
    const existing = input.id ? await this.isleRow(input.id) : null
    if (input.id && (!existing || existing.owner_id !== me.id)) fail(404, `You have no isle with id ${input.id} to update. To build on someone else's, pass it as parent instead.`)

    const parent = input.parent ? await this.visibleIsleRow(input.parent) : existing?.parent_id ? await this.isleRow(existing.parent_id) : null
    const from = input.from ? await this.visibleIsleRow(input.from) : null

    // the page: new html, or another isle's page (a rebind), or what it had, or the parent's
    let sourceHash: string
    if (input.sourceBlob) sourceHash = input.sourceBlob
    else if (input.html !== undefined) {
      const bytes = new TextEncoder().encode(input.html)
      if (bytes.byteLength > MAX_HTML_BYTES) fail(413, `An isle's page can be ${fmtBytes(MAX_HTML_BYTES)} at most; keep data in data, not in the page`)
      if (!/<\w/.test(input.html)) fail(400, 'html should be a whole HTML page')
      sourceHash = await sha256Hex(bytes)
      await this.checkQuota(me.id, sourceHash, bytes.byteLength)
      await this.putBlob(bytes, 'text/html; charset=utf-8')
    } else if (from) sourceHash = from.source_blob
    else if (existing) sourceHash = existing.source_blob
    else if (parent) sourceHash = parent.source_blob
    else return fail(400, 'Give the page as html, or name an isle to take it from with from (or parent)')

    const basis = from ?? existing ?? parent
    const slots: Record<string, SlotSpec> = input.slots ?? parseJson(basis?.slots ?? null, {})
    const bindingIds: Record<string, string> = input.bindings ?? parseJson(existing?.bindings ?? parent?.bindings ?? from?.bindings ?? null, {})
    for (const slot of Object.keys(bindingIds)) {
      if (!/^[A-Za-z_][\w-]{0,40}$/.test(slot)) fail(400, `Slot names are short identifiers; "${slot}" is not one`)
    }
    const visibility: Visibility = input.visibility ?? existing?.visibility ?? 'public'
    if (!['public', 'unlisted', 'private'].includes(visibility)) fail(400, 'visibility is public, unlisted or private')

    // every binding must be data the publisher can read; their own private data goes public with a public isle
    const madePublic: DatasetRef[] = []
    for (const [slot, did] of Object.entries(bindingIds)) {
      const d = await this.datasetRow(did)
      const inheritedOk = d && (parent || existing) && Object.values(parseJson<Record<string, string>>((existing ?? parent)!.bindings, {})).includes(did)
      if (!d || !(this.canReadDataset(d) || inheritedOk)) fail(400, `Slot "${slot}": no data with id ${did} that you can see`)
      if (visibility !== 'private' && !d!.public && d!.owner_id === me.id) {
        await this.d1.prepare('UPDATE datasets SET public = 1 WHERE id = ?').bind(d!.id).run()
        madePublic.push(await this.toDatasetRef(d!))
      }
    }

    const title = (input.title ?? existing?.title ?? (parent ? `${parent.title} (remix)` : '')).trim()
    if (!title) fail(400, 'An isle needs a title')
    const description = input.description !== undefined ? input.description : (existing?.description ?? null)
    // the relation is settled when the remix is made, or again when its publisher says whether the view changed
    let relation = existing?.relation ?? null
    if (parent && (!existing || input.view)) {
      const similarity = !input.view && sourceHash !== parent.source_blob ? pageSimilarity(await this.blobText(parent.source_blob), input.html ?? (await this.blobText(sourceHash))) : undefined
      relation = classifyRelation({ source: parent.source_blob, bindings: parseJson(parent.bindings, {}) }, { source: sourceHash, bindings: bindingIds }, { view: input.view, similarity })
    }

    const now = Date.now()
    const id = existing?.id ?? shortId()
    const samePage = existing && existing.source_blob === sourceHash && existing.bindings === JSON.stringify(bindingIds) && existing.slots === JSON.stringify(slots)
    if (existing && samePage) {
      await this.d1
        .prepare('UPDATE isles SET title = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ?')
        .bind(title.slice(0, 200), description, visibility, now, id)
        .run()
    } else if (existing) {
      await this.d1.batch([
        this.d1
          .prepare('INSERT OR IGNORE INTO isle_versions (isle_id, version, owner_id, source_blob, bindings, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(id, existing.version, me.id, existing.source_blob, existing.bindings, existing.note, existing.updated_at),
        this.d1
          .prepare('UPDATE isles SET title = ?, description = ?, source_blob = ?, slots = ?, bindings = ?, visibility = ?, version = version + 1, note = ?, updated_at = ? WHERE id = ?')
          .bind(title.slice(0, 200), description, sourceHash, JSON.stringify(slots), JSON.stringify(bindingIds), visibility, input.note ?? null, now, id),
      ])
    }
    if (existing && relation !== existing.relation) await this.d1.prepare('UPDATE isles SET relation = ? WHERE id = ?').bind(relation, id).run()
    if (!existing) {
      await this.d1
        .prepare(
          `INSERT INTO isles (id, owner_id, title, description, source_blob, slots, bindings, parent_id, relation, visibility, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, me.id, title.slice(0, 200), description, sourceHash, JSON.stringify(slots), JSON.stringify(bindingIds), parent?.id ?? null, relation, visibility, now, now)
        .run()
    }

    const uses = input.uses ?? null
    const useRows: { isle: string; meta: string }[] = []
    for (const u of uses ?? []) {
      const target = await this.isleRow(u.isle)
      if (target && this.canSeeIsle(target) && target.id !== id) useRows.push({ isle: target.id, meta: JSON.stringify({ selector: u.selector ?? null, label: u.label ?? null }) })
    }
    await this.d1.batch([
      this.d1.prepare(`DELETE FROM edges WHERE src_kind = 'isle' AND src_id = ? AND rel = 'binds'`).bind(id),
      ...(uses ? [this.d1.prepare(`DELETE FROM edges WHERE src_kind = 'isle' AND src_id = ? AND rel = 'uses'`).bind(id)] : []),
      ...Object.entries(bindingIds).map(([slot, did]) =>
        this.d1.prepare(`INSERT OR IGNORE INTO edges (src_kind, src_id, rel, dst_kind, dst_id, meta, created_at) VALUES ('isle', ?, 'binds', 'dataset', ?, ?, ?)`).bind(id, did, JSON.stringify({ slot }), now),
      ),
      ...useRows.map((u) =>
        this.d1.prepare(`INSERT OR REPLACE INTO edges (src_kind, src_id, rel, dst_kind, dst_id, meta, created_at) VALUES ('isle', ?, 'uses', 'isle', ?, ?, ?)`).bind(id, u.isle, u.meta, now),
      ),
    ])
    return { isle: (await this.getIsle(id)).isle, madePublic }
  }

  async deleteIsle(id: string) {
    const me = this.requireViewer()
    const row = await this.isleRow(id)
    if (!row || row.owner_id !== me.id) fail(404, `You have no isle with id ${id}`)
    await this.d1.batch([
      this.d1.prepare('UPDATE isles SET deleted_at = ? WHERE id = ?').bind(Date.now(), id),
      this.d1.prepare(`DELETE FROM edges WHERE src_kind = 'isle' AND src_id = ?`).bind(id),
    ])
  }

  // ---- versions ----

  /** Every version of an isle, newest first. Each update keeps the one before. */
  async versions(id: string): Promise<{ version: number; note: string | null; createdAt: number; current: boolean }[]> {
    const row = await this.visibleIsleRow(id)
    const { results } = await this.d1
      .prepare('SELECT version, note, created_at FROM isle_versions WHERE isle_id = ? ORDER BY version DESC')
      .bind(id)
      .all<{ version: number; note: string | null; created_at: number }>()
    return [
      { version: row.version, note: row.note, createdAt: row.updated_at, current: true },
      ...results.map((r) => ({ version: r.version, note: r.note, createdAt: r.created_at, current: false })),
    ]
  }

  /** Makes an old version the newest one again (the versions in between are kept). */
  async restoreVersion(id: string, version: number): Promise<Isle> {
    const me = this.requireViewer()
    const row = await this.isleRow(id)
    if (!row || row.owner_id !== me.id) fail(404, `You have no isle with id ${id}`)
    const old = await this.d1
      .prepare('SELECT source_blob, bindings FROM isle_versions WHERE isle_id = ? AND version = ?')
      .bind(id, version)
      .first<{ source_blob: string; bindings: string }>()
    if (!old) fail(404, `This isle has no version ${version} to restore`)
    return (await this.publishIsle({ id, sourceBlob: old!.source_blob, bindings: parseJson(old!.bindings, {}), note: `Restored version ${version}` })).isle
  }

  // ---- lineage ----

  private async isleNode(row: IsleRow, relation: TreeNode['relation']): Promise<TreeNode> {
    await this.persons([row.owner_id])
    return { kind: 'isle', id: row.id, title: row.title, owner: this.person(row.owner_id), relation, starCount: row.star_count, children: [] }
  }

  private async dataNode(row: DatasetRow, relation: TreeNode['relation']): Promise<TreeNode> {
    await this.persons([row.owner_id])
    return { kind: 'dataset', id: row.id, title: row.path, owner: this.person(row.owner_id), relation, children: [] }
  }

  private async isleDescendants(node: TreeNode, budget: { left: number }, depth: number) {
    if (depth > 8 || budget.left <= 0) return
    const { results } = await this.d1
      .prepare('SELECT * FROM isles WHERE parent_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 100')
      .bind(node.id)
      .all<IsleRow>()
    for (const r of results) {
      if (!this.canSeeIsle(r) || budget.left-- <= 0) continue
      const child = await this.isleNode(r, r.relation)
      node.children.push(child)
      await this.isleDescendants(child, budget, depth + 1)
    }
  }

  private async dataDescendants(node: TreeNode, budget: { left: number }, depth: number) {
    if (depth > 8 || budget.left <= 0) return
    const { results } = await this.d1
      .prepare(`SELECT d.* FROM edges e JOIN datasets d ON d.id = e.src_id WHERE e.rel = 'derived' AND e.dst_kind = 'dataset' AND e.dst_id = ? AND d.deleted_at IS NULL LIMIT 100`)
      .bind(node.id)
      .all<DatasetRow>()
    for (const r of results) {
      if (!this.canReadDataset(r) || budget.left-- <= 0) continue
      const child = await this.dataNode(r, 'derived')
      node.children.push(child)
      await this.dataDescendants(child, budget, depth + 1)
    }
  }

  async isleLineage(id: string): Promise<Lineage> {
    const row = await this.visibleIsleRow(id)
    const ancestors: TreeNode[] = []
    let cur = row
    const seen = new Set([row.id])
    while (cur.parent_id && ancestors.length < 40) {
      const p = await this.isleRow(cur.parent_id)
      if (!p || seen.has(p.id) || !this.canSeeIsle(p)) break
      seen.add(p.id)
      ancestors.unshift(await this.isleNode(p, p.relation))
      cur = p
    }
    const tree = await this.isleNode(row, row.relation)
    await this.isleDescendants(tree, { left: 300 }, 0)
    const related: TreeNode[] = []
    for (const did of Object.values(parseJson<Record<string, string>>(row.bindings, {}))) {
      const d = await this.datasetRow(did)
      if (d) related.push(await this.dataNode(d, 'binds'))
    }
    return { ancestors, tree, related }
  }

  async dataLineage(id: string): Promise<Lineage> {
    const { row } = await this.getDataset(id)
    const ancestors: TreeNode[] = []
    let cur = row
    const seen = new Set([row.id])
    while (ancestors.length < 40) {
      const p = await this.d1
        .prepare(`SELECT d.* FROM edges e JOIN datasets d ON d.id = e.dst_id WHERE e.src_kind = 'dataset' AND e.src_id = ? AND e.rel = 'derived' AND d.deleted_at IS NULL LIMIT 1`)
        .bind(cur.id)
        .first<DatasetRow>()
      if (!p || seen.has(p.id) || !this.canReadDataset(p)) break
      seen.add(p.id)
      ancestors.unshift(await this.dataNode(p, 'derived'))
      cur = p
    }
    const tree = await this.dataNode(row, null)
    await this.dataDescendants(tree, { left: 300 }, 0)
    const { results } = await this.d1
      .prepare(`SELECT i.* FROM edges e JOIN isles i ON i.id = e.src_id WHERE e.rel = 'binds' AND e.dst_kind = 'dataset' AND e.dst_id = ? AND i.deleted_at IS NULL ORDER BY i.star_count DESC LIMIT 200`)
      .bind(id)
      .all<IsleRow>()
    const related: TreeNode[] = []
    for (const r of results) if (this.canSeeIsle(r)) related.push(await this.isleNode(r, 'binds'))
    return { ancestors, tree, related }
  }

  /** The whole public archipelago: every root isle with what grew from it. */
  async forest(limit = 60): Promise<TreeNode[]> {
    const { results } = await this.d1
      .prepare(
        `SELECT r.* FROM isles r WHERE r.deleted_at IS NULL AND r.visibility = 'public'
         AND (r.parent_id IS NULL OR r.parent_id NOT IN (SELECT id FROM isles WHERE deleted_at IS NULL AND visibility = 'public'))
         ORDER BY r.star_count DESC, r.updated_at DESC LIMIT ?`,
      )
      .bind(limit)
      .all<IsleRow>()
    const budget = { left: 600 }
    const out: TreeNode[] = []
    for (const r of results) {
      const node = await this.isleNode(r, null)
      await this.isleDescendants(node, budget, 0)
      out.push(node)
    }
    return out
  }

  /** Every public isle in one flat, compact list, oldest first: the client lays out and draws the sea. */
  async chart(limit = 20000): Promise<SeaChart> {
    const isles = await this.d1
      .prepare(
        `SELECT i.id, i.parent_id, i.title, i.star_count, i.relation, i.created_at, i.version, i.bindings, i.owner_id, i.shot_version, i.source_blob, u.handle, u.name
         FROM isles i JOIN users u ON u.id = i.owner_id
         WHERE i.deleted_at IS NULL AND i.visibility = 'public' ORDER BY i.created_at LIMIT ?`,
      )
      .bind(limit)
      .all<Pick<IsleRow, 'id' | 'parent_id' | 'title' | 'star_count' | 'relation' | 'created_at' | 'version' | 'bindings' | 'owner_id' | 'shot_version' | 'source_blob'> & { handle: string | null; name: string | null }>()
    const data = await this.d1
      .prepare(
        `SELECT DISTINCT d.id, d.path, d.kind, d.public FROM isles i, json_each(i.bindings) j JOIN datasets d ON d.id = j.value
         WHERE i.deleted_at IS NULL AND i.visibility = 'public' AND d.deleted_at IS NULL`,
      )
      .all<{ id: string; path: string; kind: string; public: number }>()
    // where each shown dataset came from: walk derived-from up to the original data (a dataset with no parents)
    const roots = await this.d1
      .prepare(
        `WITH RECURSIVE shown(id) AS (
           SELECT DISTINCT j.value FROM isles i, json_each(i.bindings) j WHERE i.deleted_at IS NULL AND i.visibility = 'public'
         ), up(start, id, depth) AS (
           SELECT id, id, 0 FROM shown
           UNION
           SELECT up.start, e.dst_id, up.depth + 1 FROM up JOIN edges e ON e.src_kind = 'dataset' AND e.src_id = up.id AND e.rel = 'derived' AND e.dst_kind = 'dataset'
           WHERE up.depth < 24
         )
         SELECT DISTINCT up.start, d.id, d.path, d.kind, d.public FROM up JOIN datasets d ON d.id = up.id AND d.deleted_at IS NULL
         WHERE up.depth > 0 AND NOT EXISTS (SELECT 1 FROM edges p WHERE p.src_kind = 'dataset' AND p.src_id = up.id AND p.rel = 'derived')`,
      )
      .all<{ start: string; id: string; path: string; kind: string; public: number }>()
    const dataIndex = new Map<string, number>()
    const chart: SeaChart = { islesOrigin: islesOrigin(this.request, this.env), people: [], data: [], isles: [] }
    const addData = (d: { id: string; path: string; kind: string; public: number }) => {
      let i = dataIndex.get(d.id)
      if (i === undefined) {
        i = chart.data.length
        dataIndex.set(d.id, i)
        chart.data.push(d.public ? [d.id, d.path, d.kind, []] : [null, null, d.kind, []])
      }
      return i
    }
    for (const d of data.results) addData(d)
    for (const r of roots.results) {
      const from = dataIndex.get(r.start)
      if (from === undefined) continue
      const src = addData(r)
      const list = chart.data[from]![3]!
      if (src !== from && !list.includes(src)) list.push(src)
    }
    const pageIndex = new Map<string, number>()
    const personIndex = new Map<string, number>()
    const shown = new Set(isles.results.map((r) => r.id))
    for (const r of isles.results) {
      let p = personIndex.get(r.owner_id)
      if (p === undefined) {
        p = chart.people.length
        personIndex.set(r.owner_id, p)
        chart.people.push([r.handle, r.name])
      }
      const uses = Object.values(parseJson<Record<string, string>>(r.bindings, {}))
        .map((id) => dataIndex.get(id))
        .filter((i): i is number => i !== undefined)
      // a parent that isn't public stays unnamed: its id is the only way in to an unlisted isle
      const parent = r.parent_id && shown.has(r.parent_id) ? r.parent_id : null
      let page = pageIndex.get(r.source_blob)
      if (page === undefined) pageIndex.set(r.source_blob, (page = pageIndex.size))
      chart.isles.push([r.id, parent, r.title, p, r.star_count, parent ? r.relation : null, r.created_at, r.version, [...new Set(uses)], r.shot_version ?? 0, page])
    }
    return chart
  }

  // ---- marks: stars, reactions, comments ----

  private async toMark(r: MarkRow): Promise<Mark> {
    await this.persons([r.user_id])
    return {
      id: r.id,
      user: this.person(r.user_id),
      isleId: r.isle_id,
      kind: r.kind,
      anchorKey: r.anchor_key,
      anchor: parseJson<Anchor | null>(r.anchor, null),
      emoji: r.emoji,
      body: r.body,
      parentId: r.parent_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  }

  private cleanAnchor(anchor: Anchor | null | undefined): Anchor | null {
    if (!anchor?.selector?.trim()) return null
    return {
      selector: anchor.selector.trim().slice(0, 500),
      label: anchor.label?.slice(0, 120),
      tag: anchor.tag?.slice(0, 20),
      text: anchor.text?.slice(0, 160),
      state: cleanState(anchor.state),
    }
  }

  private async refreshStarCount(isleId: string) {
    await this.d1
      .prepare(`UPDATE isles SET star_count = (SELECT COUNT(*) FROM marks WHERE isle_id = ?1 AND kind = 'star' AND deleted_at IS NULL) WHERE id = ?1`)
      .bind(isleId)
      .run()
  }

  /** Stars (or unstars) the whole isle, or one element of it. Returns whether it is now starred. */
  async star(isleId: string, opts: { anchor?: Anchor | null; on?: boolean; snippet?: string | null }): Promise<boolean> {
    const me = this.requireViewer()
    await this.visibleIsleRow(isleId)
    const anchor = this.cleanAnchor(opts.anchor)
    const key = anchorKeyOf(anchor)
    const current = await this.d1
      .prepare(`SELECT id FROM marks WHERE user_id = ? AND isle_id = ? AND anchor_key = ? AND kind = 'star' AND deleted_at IS NULL`)
      .bind(me.id, isleId, key)
      .first<{ id: string }>()
    const on = opts.on ?? !current
    if (on && !current) {
      const now = Date.now()
      await this.d1
        .prepare(`INSERT INTO marks (id, user_id, isle_id, anchor_key, anchor, snippet, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'star', ?, ?)`)
        .bind(shortId(14), me.id, isleId, key, anchor ? JSON.stringify(anchor) : null, opts.snippet?.slice(0, MAX_SNIPPET) ?? null, now, now)
        .run()
    } else if (!on && current) {
      await this.d1.prepare('UPDATE marks SET deleted_at = ? WHERE id = ?').bind(Date.now(), current.id).run()
    }
    if (!key) await this.refreshStarCount(isleId)
    return on
  }

  /** Toggles an emoji reaction on one comment. Returns whether it is now on. */
  async react(isleId: string, commentId: string, emoji: string, opts: { on?: boolean } = {}): Promise<boolean> {
    const me = this.requireViewer()
    await this.visibleIsleRow(isleId)
    const e = emoji.trim()
    if (!e || e.length > 16 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(e)) fail(400, 'A reaction is one emoji')
    const target = await this.d1.prepare(`SELECT id FROM marks WHERE id = ? AND isle_id = ? AND kind = 'comment' AND deleted_at IS NULL`).bind(commentId, isleId).first()
    if (!target) fail(404, 'Reactions go on comments, and that comment is gone')
    const current = await this.d1
      .prepare(`SELECT id FROM marks WHERE user_id = ? AND parent_id = ? AND kind = 'react' AND emoji = ? AND deleted_at IS NULL`)
      .bind(me.id, commentId, e)
      .first<{ id: string }>()
    const on = opts.on ?? !current
    if (on && !current) {
      const now = Date.now()
      await this.d1
        .prepare(`INSERT INTO marks (id, user_id, isle_id, anchor_key, kind, emoji, parent_id, created_at, updated_at) VALUES (?, ?, ?, '', 'react', ?, ?, ?, ?)`)
        .bind(shortId(14), me.id, isleId, e, commentId, now, now)
        .run()
    } else if (!on && current) {
      await this.d1.prepare('UPDATE marks SET deleted_at = ? WHERE id = ?').bind(Date.now(), current.id).run()
    }
    return on
  }

  async comment(isleId: string, body: string, opts: { anchor?: Anchor | null; replyTo?: string | null; snippet?: string | null }): Promise<Mark> {
    const me = this.requireViewer()
    await this.visibleIsleRow(isleId)
    const text = body.trim()
    if (!text) fail(400, 'Say something')
    if (text.length > MAX_COMMENT) fail(400, `Comments are ${MAX_COMMENT} characters at most`)
    let anchor = this.cleanAnchor(opts.anchor)
    let parentId: string | null = null
    if (opts.replyTo) {
      const parent = await this.d1.prepare(`SELECT * FROM marks WHERE id = ? AND isle_id = ? AND kind = 'comment' AND deleted_at IS NULL`).bind(opts.replyTo, isleId).first<MarkRow>()
      if (!parent) fail(404, 'That comment is gone')
      parentId = parent!.parent_id ?? parent!.id
      anchor = parseJson<Anchor | null>(parent!.anchor, null)
    }
    const now = Date.now()
    const id = shortId(14)
    await this.d1
      .prepare(`INSERT INTO marks (id, user_id, isle_id, anchor_key, anchor, snippet, kind, body, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'comment', ?, ?, ?, ?)`)
      .bind(id, me.id, isleId, anchorKeyOf(anchor), anchor ? JSON.stringify(anchor) : null, opts.snippet?.slice(0, MAX_SNIPPET) ?? null, text, parentId, now, now)
      .run()
    return this.toMark((await this.d1.prepare('SELECT * FROM marks WHERE id = ?').bind(id).first<MarkRow>())!)
  }

  /** Your own marks go; so do comments on your isles. */
  async deleteMark(id: string) {
    const me = this.requireViewer()
    const row = await this.d1.prepare('SELECT m.*, i.owner_id AS isle_owner FROM marks m JOIN isles i ON i.id = m.isle_id WHERE m.id = ? AND m.deleted_at IS NULL').bind(id).first<MarkRow & { isle_owner: string }>()
    if (!row || (row.user_id !== me.id && !(row.kind === 'comment' && row.isle_owner === me.id))) fail(404, 'No such mark of yours')
    await this.d1.prepare('UPDATE marks SET deleted_at = ? WHERE id = ? OR parent_id = ?').bind(Date.now(), id, id).run()
    if (row!.kind === 'star') await this.refreshStarCount(row!.isle_id)
  }

  /**
   * Everything on one isle. Stars are tallied for everyone (they are quiet);
   * comments come in layers so a busy isle is not noisy: yours, the author's, people you follow, everyone's.
   */
  async marks(isleId: string, layer: Layer = 'following'): Promise<{ tallies: Tally[]; comments: Mark[]; layers: Record<Layer, number> }> {
    const row = await this.visibleIsleRow(isleId)
    const { results } = await this.d1.prepare('SELECT * FROM marks WHERE isle_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 2000').bind(isleId).all<MarkRow>()
    const me = this.viewer?.id
    const following = new Set(me ? await this.db.followingIds(me) : [])

    const tallies = new Map<string, Tally>()
    const tally = (r: MarkRow) => {
      let t = tallies.get(r.anchor_key)
      if (!t) {
        t = { anchorKey: r.anchor_key, anchor: parseJson<Anchor | null>(r.anchor, null), stars: 0, starredByMe: false, comments: 0 }
        tallies.set(r.anchor_key, t)
      }
      return t
    }

    const inLayer = (userId: string, l: Layer) =>
      l === 'everyone' ||
      userId === me ||
      (l !== 'mine' && userId === row.owner_id) ||
      (l === 'following' && following.has(userId))

    const counts: Record<Layer, number> = { mine: 0, author: 0, following: 0, everyone: 0 }
    const comments: MarkRow[] = []
    const threadOk = new Map<string, boolean>()
    const reactions = new Map<string, Record<string, { count: number; mine: boolean }>>()
    for (const r of results) {
      if (r.kind === 'react') {
        // on a comment (older reactions on the page or a piece are no longer shown)
        if (!r.parent_id || !r.emoji) continue
        const forComment = reactions.get(r.parent_id) ?? {}
        reactions.set(r.parent_id, forComment)
        const x = (forComment[r.emoji] ??= { count: 0, mine: false })
        x.count++
        if (r.user_id === me) x.mine = true
        continue
      }
      const t = tally(r)
      if (r.kind === 'star') {
        t.stars++
        if (r.user_id === me) t.starredByMe = true
      } else if (r.kind === 'comment') {
        for (const l of Object.keys(counts) as Layer[]) if (inLayer(r.user_id, l)) counts[l]++
        // a thread shows when its first comment is in the layer; replies come with it
        if (!r.parent_id) threadOk.set(r.id, inLayer(r.user_id, layer))
        if (r.parent_id ? threadOk.get(r.parent_id) || inLayer(r.user_id, layer) : threadOk.get(r.id)) {
          comments.push(r)
          t.comments++
        }
      }
    }
    await this.persons(comments.map((c) => c.user_id))
    return {
      tallies: [...tallies.values()].filter((t) => t.stars || t.comments),
      comments: await Promise.all(comments.map(async (c) => ({ ...(await this.toMark(c)), reactions: reactions.get(c.id) ?? {} }))),
      layers: counts,
    }
  }

  /** What a person has starred and said: their board of go-tos, for them and their agent. */
  async library(userId?: string, opts: { kind?: MarkKind; limit?: number } = {}): Promise<LibraryItem[]> {
    const uid = userId ?? this.requireViewer().id
    const kinds = opts.kind ? [opts.kind] : ['star', 'comment']
    const { results } = await this.d1
      .prepare(
        `SELECT m.* FROM marks m JOIN isles i ON i.id = m.isle_id WHERE m.user_id = ? AND m.deleted_at IS NULL AND i.deleted_at IS NULL
         AND m.kind IN (${kinds.map(() => '?').join(',')}) AND m.parent_id IS NULL ORDER BY m.created_at DESC LIMIT ?`,
      )
      .bind(uid, ...kinds, Math.min(opts.limit ?? 200, 500))
      .all<MarkRow>()
    const out: LibraryItem[] = []
    const isles = new Map<string, IsleSummary | null>()
    for (const r of results) {
      if (!isles.has(r.isle_id)) {
        const row = await this.isleRow(r.isle_id)
        isles.set(r.isle_id, row && this.canSeeIsle(row) ? await this.toSummary(row) : null)
      }
      const isle = isles.get(r.isle_id)
      if (isle) out.push({ mark: await this.toMark(r), isle, snippet: r.snippet })
    }
    return out
  }
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
