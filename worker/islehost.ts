import { appOrigin, islesOrigin, verifyIsle } from './auth'
import type { IsleRow } from './store'

/**
 * isles.prolifica.app: where people's pages run. A different origin from the app, so an isle's
 * script can never read the app's cookies, storage or API as the viewer. It serves three things:
 *
 *   /<isle>?v=&g=          the page, with the bridge injected
 *   /<isle>/data/<slot>    the data bound to that slot (what prolifica.data() fetches)
 *   /bridge.js             the bridge itself (from the app's static assets)
 *
 * Public and unlisted isles are open to anyone; a private one needs the signed grant (g) the app hands its owner.
 */

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

function escapeScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

export function injectBridge(html: string, config: unknown, preload: string[] = []): string {
  // the data starts downloading alongside the page instead of after the isle's script asks for it
  const early = preload.map((href) => `<link rel="preload" href="${href.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`)}" as="fetch" crossorigin="anonymous">`).join('')
  const tags = `${early}<script>window.__PROLIFICA__=${escapeScriptJson(config)}</script><script src="/bridge.js"></script>`
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + tags + html.slice(head.index + head[0].length)
  const doc = /<html(\s[^>]*)?>/i.exec(html)
  if (doc) return html.slice(0, doc.index + doc[0].length) + `<head>${tags}</head>` + html.slice(doc.index + doc[0].length)
  const doctype = /<!doctype[^>]*>/i.exec(html)
  if (doctype) return html.slice(0, doctype.index + doctype[0].length) + tags + html.slice(doctype.index + doctype[0].length)
  return tags + html
}

function notFound(message = 'No such isle') {
  return new Response(message, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS } })
}

export async function handleIslesHost(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  if (url.pathname === '/bridge.js' || url.pathname === '/favicon.ico') return env.ASSETS.fetch(request)
  if (url.pathname === '/') return Response.redirect(appOrigin(request, env), 302)

  const m = /^\/([a-z0-9]{6,16})(?:\/data\/([A-Za-z_][\w-]{0,40}))?\/?$/.exec(url.pathname)
  if (!m) return notFound()
  const [, isleId, slot] = m
  const isle = await env.DB.prepare('SELECT * FROM isles WHERE id = ? AND deleted_at IS NULL').bind(isleId).first<IsleRow>()
  if (!isle) return notFound()
  const grant = url.searchParams.get('g')
  if (isle.visibility === 'private' && !(await verifyIsle(env, isle.id, grant))) return notFound()
  const cache = isle.visibility === 'private' ? 'private, no-store' : 'public, max-age=60'

  // ?v=<n> for an older version shows that version's page and data (the current one is on the isle itself)
  const v = Number(url.searchParams.get('v'))
  if (Number.isInteger(v) && v > 0 && v < isle.version) {
    const old = await env.DB.prepare('SELECT source_blob, bindings FROM isle_versions WHERE isle_id = ? AND version = ?').bind(isle.id, v).first<{ source_blob: string; bindings: string }>()
    if (!old) return notFound(`This isle has no version ${v}`)
    isle.source_blob = old.source_blob
    isle.bindings = old.bindings
    isle.version = v
  }

  if (slot) {
    const bindings = JSON.parse(isle.bindings || '{}') as Record<string, string>
    const datasetId = bindings[slot]
    if (!datasetId) return notFound(`This isle has no data in slot "${slot}"`)
    const d = await env.DB.prepare('SELECT blob, content_type FROM datasets WHERE id = ? AND deleted_at IS NULL').bind(datasetId).first<{ blob: string; content_type: string }>()
    if (!d) return notFound(`The data in slot "${slot}" was deleted`)
    // blobs are content-addressed: a URL naming the blob (?h=, which the bridge adds) never changes what it returns
    const h = url.searchParams.get('h')
    const pinned = !!h && h.length >= 12 && d.blob.startsWith(h)
    const dataCache = pinned && isle.visibility !== 'private' ? 'public, max-age=31536000, immutable' : cache
    const etag = `"${d.blob}"`
    if (request.headers.get('if-none-match')?.includes(d.blob)) return new Response(null, { status: 304, headers: { etag, 'cache-control': dataCache, ...SECURITY_HEADERS } })
    const obj = await env.BLOBS.get(`blobs/${d.blob}`)
    if (!obj) return notFound('The data is missing')
    const type = d.content_type.startsWith('text/') && !d.content_type.includes('charset') ? `${d.content_type}; charset=utf-8` : d.content_type
    return new Response(obj.body, {
      headers: {
        'content-type': type,
        'cache-control': dataCache,
        etag,
        // an svg (or anything) opened directly must not run script with this origin
        'content-security-policy': "default-src 'none'; img-src * data:; style-src 'unsafe-inline'",
        'access-control-allow-origin': '*',
        ...SECURITY_HEADERS,
      },
    })
  }

  const obj = await env.BLOBS.get(`blobs/${isle.source_blob}`)
  if (!obj) return notFound('The page is missing')
  const slots = JSON.parse(isle.slots || '{}') as Record<string, unknown>
  const bindings = JSON.parse(isle.bindings || '{}') as Record<string, string>
  const bound = Object.keys(bindings).length
    ? (
        await env.DB.prepare(`SELECT id, path, kind, content_type, blob FROM datasets WHERE id IN (${Object.values(bindings).map(() => '?').join(',')}) AND deleted_at IS NULL`)
          .bind(...Object.values(bindings))
          .all<{ id: string; path: string; kind: string; content_type: string; blob: string }>()
      ).results
    : []
  const byId = new Map(bound.map((d) => [d.id, d]))
  const config = {
    isle: { id: isle.id, title: isle.title, version: isle.version },
    version: url.searchParams.get('v'),
    slots,
    bindings: Object.fromEntries(
      Object.entries(bindings).map(([k, id]) => {
        const d = byId.get(id)
        return [k, d ? { id, path: d.path, kind: d.kind, contentType: d.content_type, hash: d.blob.slice(0, 16) } : null]
      }),
    ),
    grant: isle.visibility === 'private' ? grant : null,
    app: appOrigin(request, env),
    origin: islesOrigin(request, env),
  }
  // the same URLs the bridge's dataUrl() builds, for the kinds prolifica.data() fetches
  const preload = Object.entries(config.bindings).flatMap(([slot, b]) => {
    if (!b || b.kind === 'image' || b.kind === 'binary') return []
    const q = new URLSearchParams()
    if (config.version) q.set('v', config.version)
    if (config.grant) q.set('g', config.grant)
    q.set('h', b.hash)
    return [`/${isle.id}/data/${encodeURIComponent(slot)}?${q}`]
  })
  return new Response(injectBridge(await obj.text(), config, preload), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': cache, ...SECURITY_HEADERS },
  })
}
