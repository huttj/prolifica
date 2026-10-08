import type { ApiToken, Anchor, Dataset, DatasetRef, Evolution, Isle, IsleSummary, IsleVersion, LibraryItem, Lineage, Mark, Me, Person, SeaChart, SiteInfo, SiteSummary, TreeNode, Visibility } from '../shared/types'

export interface SourcePatch {
  url?: string | null
  method?: string | null
  notes?: string | null
  collectedAt?: number | null
  code?: string | null
  codeLanguage?: string | null
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function call<T>(method: string, path: string, body?: unknown, init: RequestInit & { as?: 'text' } = {}): Promise<T> {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined || isRaw ? init.headers : { 'content-type': 'application/json', ...init.headers },
    body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body),
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      message = ((await res.json()) as { error?: string }).error ?? message
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, message)
  }
  const type = res.headers.get('content-type') ?? ''
  return (init.as !== 'text' && type.includes('json') ? res.json() : res.text()) as Promise<T>
}

export interface Tally {
  anchorKey: string
  anchor: Anchor | null
  stars: number
  starredByMe: boolean
  comments: number
}
export type Layer = 'mine' | 'author' | 'following' | 'everyone'
export interface Marks {
  tallies: Tally[]
  comments: Mark[]
  layers: Record<Layer, number>
}

const q = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  me: () => call<Me>('GET', '/api/me'),
  updateMe: (patch: { handle?: string; name?: string; bio?: string }) => call<Me>('PATCH', '/api/me', patch),
  requestLink: (email: string, next?: string) => call<{ ok: true; dev?: boolean }>('POST', '/api/auth/request', { email, next }),
  redeemCode: (email: string, code: string) => call<{ ok: true; next: string }>('POST', '/api/auth/code', { email, code }),
  logout: () => call('POST', '/api/auth/logout', {}),
  tokens: () => call<ApiToken[]>('GET', '/api/me/tokens'),
  createToken: (label: string) => call<{ token: string; row: ApiToken }>('POST', '/api/me/tokens', { label }),
  revokeToken: (id: string) => call('DELETE', `/api/me/tokens/${encodeURIComponent(id)}`),

  person: (handle: string) => call<{ person: Person; following: boolean; isMe: boolean }>('GET', `/api/people/${encodeURIComponent(handle)}`),
  follow: (handle: string, on: boolean) => call('POST', `/api/people/${encodeURIComponent(handle)}/follow`, { on }),

  isles: (o: { sort?: 'recent' | 'stars'; q?: string; handle?: string; limit?: number; offset?: number } = {}) => call<IsleSummary[]>('GET', `/api/isles${q(o)}`),
  isle: (id: string) => call<Isle>('GET', `/api/isles/${id}`),
  isleSource: (id: string, v?: number) => call<string>('GET', `/api/isles/${id}/source${v ? `?v=${v}` : ''}`, undefined, { as: 'text' }),
  evolution: (id: string) => call<Evolution>('GET', `/api/isles/${id}/evolution`),
  updateIsle: (id: string, patch: { title?: string; description?: string | null; visibility?: Visibility; shortTitle?: string | null; viewName?: string | null }) => call<Isle>('PATCH', `/api/isles/${id}`, patch),
  deleteIsle: (id: string) => call('DELETE', `/api/isles/${id}`),
  rebind: (id: string, bindings: Record<string, string>, title?: string) => call<Isle>('POST', `/api/isles/${id}/rebind`, { bindings, title }),
  isleLineage: (id: string) => call<Lineage>('GET', `/api/isles/${id}/lineage`),
  marks: (id: string, layer: Layer) => call<Marks>('GET', `/api/isles/${id}/marks${q({ layer })}`),
  star: (id: string, o: { anchor?: Anchor | null; on?: boolean; snippet?: string }) => call<{ on: boolean }>('POST', `/api/isles/${id}/star`, o),
  react: (id: string, comment: string, emoji: string) => call<{ on: boolean }>('POST', `/api/isles/${id}/react`, { comment, emoji }),
  versions: (id: string) => call<IsleVersion[]>('GET', `/api/isles/${id}/versions`),
  restore: (id: string, version: number) => call<Isle>('POST', `/api/isles/${id}/restore`, { version }),
  comment: (id: string, body: string, o: { anchor?: Anchor | null; replyTo?: string; snippet?: string }) => call<Mark>('POST', `/api/isles/${id}/comments`, { body, ...o }),
  deleteMark: (id: string) => call('DELETE', `/api/marks/${id}`),
  forest: () => call<TreeNode[]>('GET', '/api/forest'),
  chart: () => call<SeaChart>('GET', '/api/chart'),
  sites: () => call<SiteSummary[]>('GET', '/api/sites'),
  site: (site: string) => call<SiteInfo>('GET', `/api/sites/${encodeURIComponent(site)}`),
  collector: (hash: string) => call<string>('GET', `/api/collectors/${hash}`, undefined, { as: 'text' }),
  library: (handle?: string) => call<LibraryItem[]>('GET', `/api/library${q({ handle })}`),

  data: (o: { handle?: string; folder?: string } = {}) => call<Dataset[]>('GET', `/api/data${q(o)}`),
  dataset: (id: string) => call<Dataset>('GET', `/api/data/${id}`),
  // always the file as written: a .json dataset must come back as text, not parsed
  dataText: (id: string) => call<string>('GET', `/api/data/${id}/raw`, undefined, { as: 'text' }),
  dataLineage: (id: string) => call<Lineage>('GET', `/api/data/${id}/lineage`),
  upload: (path: string, file: Blob) => call<Dataset>('POST', `/api/data${q({ path })}`, file, { headers: { 'content-type': file.type || 'application/octet-stream' } }),
  updateData: (id: string, patch: { path?: string; description?: string | null; public?: boolean; source?: SourcePatch }) => call<Dataset>('PATCH', `/api/data/${id}`, patch),
  collectorCode: (id: string) => call<string>('GET', `/api/data/${id}/collector`, undefined, { as: 'text' }),
  sameCollector: (id: string) => call<DatasetRef[]>('GET', `/api/data/${id}/same-collector`),
  deleteData: (id: string) => call('DELETE', `/api/data/${id}`),
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export const who = (p: Person) => (p.handle ? `@${p.handle}` : p.name ?? 'someone')
