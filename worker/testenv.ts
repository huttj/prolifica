/**
 * An in-memory Env for tests: D1 on node:sqlite with the real migrations applied, R2 on a Map.
 * Enough of each binding for the store and the API router; no network, no email.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

type Value = string | number | bigint | null | Uint8Array

const norm = (args: unknown[]): Value[] =>
  args.map((a) => {
    if (a === undefined) throw new Error('D1_TYPE_ERROR: undefined is not a supported type')
    if (typeof a === 'boolean') return a ? 1 : 0
    if (a instanceof ArrayBuffer) return new Uint8Array(a)
    return a as Value
  })

const plain = (r: unknown) => (r ? { ...(r as object) } : null)

class Statement {
  constructor(private db: DatabaseSync, private sql: string, private args: Value[] = []) {}
  bind(...args: unknown[]) {
    return new Statement(this.db, this.sql, norm(args))
  }
  async first<T>(col?: string): Promise<T | null> {
    const r = plain(this.db.prepare(this.sql).get(...this.args)) as Record<string, unknown> | null
    return (r ? (col ? r[col] : r) : null) as T | null
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.args).map(plain) as T[], success: true, meta: {} }
  }
  async run() {
    const s = this.db.prepare(this.sql)
    // statements with RETURNING (and plain SELECTs sent through run) give rows
    if (/\breturning\b/i.test(this.sql) || /^\s*select\b/i.test(this.sql)) return { results: s.all(...this.args).map(plain), success: true, meta: { changes: 0 } }
    const info = s.run(...this.args)
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }
  }
  async raw() {
    return this.db.prepare(this.sql).all(...this.args).map((r) => Object.values(r as object))
  }
}

class FakeD1 {
  db = new DatabaseSync(':memory:')
  prepare(sql: string) {
    return new Statement(this.db, sql)
  }
  async batch(stmts: Statement[]) {
    this.db.exec('BEGIN')
    try {
      const out = []
      for (const s of stmts) out.push(await s.run())
      this.db.exec('COMMIT')
      return out
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  async exec(sql: string) {
    this.db.exec(sql)
    return { count: 0, duration: 0 }
  }
}

class FakeR2 {
  objects = new Map<string, { bytes: Uint8Array; httpMetadata?: unknown }>()
  async put(key: string, value: Uint8Array | ArrayBuffer | string, opts?: { httpMetadata?: unknown }) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value)
    this.objects.set(key, { bytes, httpMetadata: opts?.httpMetadata })
    return { key }
  }
  async get(key: string) {
    const o = this.objects.get(key)
    if (!o) return null
    return {
      key,
      httpMetadata: o.httpMetadata,
      get body() {
        return new Blob([o.bytes as Uint8Array<ArrayBuffer>]).stream()
      },
      text: async () => new TextDecoder().decode(o.bytes),
      arrayBuffer: async () => o.bytes.slice().buffer,
      json: async () => JSON.parse(new TextDecoder().decode(o.bytes)),
    }
  }
  async head(key: string) {
    return this.objects.has(key) ? { key } : null
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k)
  }
  async list(opts: { prefix?: string } = {}) {
    return { objects: [...this.objects.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).map((key) => ({ key })), truncated: false, cursor: undefined }
  }
}

export function testEnv(): Env {
  const d1 = new FakeD1()
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url))
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) d1.db.exec(readFileSync(dir + f, 'utf8'))
  return {
    DB: d1,
    BLOBS: new FakeR2(),
    SITE_URL: 'https://prolifica.app',
    ISLES_URL: 'https://isles.prolifica.app',
    QUOTA_BYTES: '10485760',
    ADMIN_QUOTA_BYTES: '104857600',
    SIGNING_KEY: 'test-signing-key',
    ADMINS: '',
    EMAIL_FROM: 'Prolifica <hello@prolifica.app>',
  } as unknown as Env
}

export const testCtx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext
