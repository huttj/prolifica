import puppeteer from '@cloudflare/puppeteer'
import { signIsle } from './auth'

/**
 * Static previews. Cards, the map and the library show a picture of an isle instead of running it:
 * a live page per card is slow and heavy. A headless browser (Cloudflare Browser Rendering) opens the
 * isle the way a visitor would and takes one screenshot per version, kept in R2 next to the blobs.
 *
 * Shots are taken after a publish, and lazily when a card asks for one that's missing or stale, so
 * isles from before this existed fill in on their own.
 */

export const SHOT_W = 1280
export const SHOT_H = 800
const RETRY_MS = 3 * 60 * 1000

const MAX_H = 2000

export const shotKey = (isleId: string, version: number) => `shots/${isleId}/v${version}.webp`
/** Where marked pieces sit in the picture, so the library can show just that piece. */
export const rectsKey = (isleId: string, version: number) => `shots/${isleId}/v${version}.json`

export interface ShotRects {
  width: number
  height: number
  /** selector -> [x, y, w, h] in the picture's pixels */
  rects: Record<string, [number, number, number, number]>
}

interface ShotRow {
  id: string
  version: number
  visibility: string
  shot_version: number | null
  shot_at: number | null
}

/** Take a shot of the isle's current version unless there is one, or one is already being taken. */
export async function shootIsle(env: Env, isleId: string, islesOrigin: string, force = false): Promise<void> {
  const row = await env.DB.prepare('SELECT id, version, visibility, shot_version, shot_at FROM isles WHERE id = ? AND deleted_at IS NULL').bind(isleId).first<ShotRow>()
  if (!row || row.shot_version === row.version) return
  const now = Date.now()
  // claim it, so a burst of card views takes one shot, not many
  const claimed = await env.DB.prepare('UPDATE isles SET shot_at = ? WHERE id = ? AND (shot_at IS NULL OR shot_at < ? OR ?)')
    .bind(now, row.id, now - RETRY_MS, force ? 1 : 0)
    .run()
  if (!claimed.meta.changes) return

  let url = `${islesOrigin}/${row.id}?v=${row.version}`
  if (row.visibility === 'private') url += `&g=${encodeURIComponent(await signIsle(env, row.id))}`
  const browser = await puppeteer.launch(env.BROWSER)
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: SHOT_W, height: SHOT_H, deviceScaleFactor: 1 })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25_000 }).catch(() => {})
    // let charts finish drawing and anything animated settle
    await new Promise((r) => setTimeout(r, 1500))
    const marked = await env.DB.prepare(`SELECT DISTINCT json_extract(anchor, '$.selector') AS s FROM marks WHERE isle_id = ? AND anchor IS NOT NULL LIMIT 200`)
      .bind(row.id)
      .all<{ s: string | null }>()
    // the page down to MAX_H (cards show its top; the library crops pieces out of it)
    const rects = (await page.evaluate(
      `(() => {
        const out = {}
        const add = (sel, el) => { const r = el.getBoundingClientRect(); if (r.width && r.height) out[sel] = [r.left + scrollX, r.top + scrollY, r.width, r.height].map(Math.round) }
        for (const el of [...document.querySelectorAll('[data-pid]')].slice(0, 400)) add('[data-pid=' + JSON.stringify(el.getAttribute('data-pid')) + ']', el)
        for (const sel of ${JSON.stringify(marked.results.map((m) => m.s).filter(Boolean))}) { try { const el = document.querySelector(sel); if (el) add(sel, el) } catch {} }
        return { height: Math.min(${MAX_H}, Math.max(document.documentElement.scrollHeight, innerHeight)), rects: out }
      })()`,
    )) as { height: number; rects: ShotRects['rects'] }
    const image = await page.screenshot({ type: 'webp', quality: 80, clip: { x: 0, y: 0, width: SHOT_W, height: rects.height }, captureBeyondViewport: true })
    await env.BLOBS.put(shotKey(row.id, row.version), image, { httpMetadata: { contentType: 'image/webp' } })
    const meta: ShotRects = { width: SHOT_W, height: rects.height, rects: rects.rects }
    await env.BLOBS.put(rectsKey(row.id, row.version), JSON.stringify(meta), { httpMetadata: { contentType: 'application/json' } })
    const done = await env.DB.prepare('UPDATE isles SET shot_version = ? WHERE id = ? AND (shot_version IS NULL OR shot_version < ?)').bind(row.version, row.id, row.version).run()
    if (done.meta.changes && row.shot_version) await env.BLOBS.delete([shotKey(row.id, row.shot_version), rectsKey(row.id, row.shot_version)])
  } finally {
    await browser.close()
  }
}

/** Fire and forget, logging failures (a missing shot only means a placeholder). */
export function shootLater(ctx: { waitUntil(p: Promise<unknown>): void } | undefined, env: Env, isleId: string, islesOrigin: string, force = false) {
  const p = shootIsle(env, isleId, islesOrigin, force).catch((e) => console.error('shot failed', isleId, e))
  if (ctx) ctx.waitUntil(p)
}

// ---- checking: what an agent sees when it tests the isle it just published ----

export interface IsleCheck {
  url: string
  width: number
  height: number
  scheme: 'light' | 'dark'
  /** script errors and console errors, in order */
  errors: string[]
  /** requests that failed or came back 4xx/5xx (data slots included) */
  failed: string[]
  /** each data slot the page asked for, and how it went */
  slots: { slot: string; status: number }[]
  /** the visible text, trimmed, so an empty or stuck page is obvious */
  text: string
  /** the page is taller or wider than the window */
  scroll: { width: number; height: number }
  image: Uint8Array
}

/**
 * Open an isle the way a visitor would (any width, light or dark), wait for it to settle, and report
 * what went wrong along with a screenshot. Access is the caller's to check first.
 */
export async function checkIsle(env: Env, isle: { id: string; version: number; visibility: string }, islesOrigin: string, opts: { width?: number; height?: number; dark?: boolean; wait?: number } = {}): Promise<IsleCheck> {
  const width = Math.max(320, Math.min(1920, Math.round(opts.width ?? SHOT_W)))
  const height = Math.max(320, Math.min(1400, Math.round(opts.height ?? SHOT_H)))
  let url = `${islesOrigin}/${isle.id}?v=${isle.version}`
  if (isle.visibility === 'private') url += `&g=${encodeURIComponent(await signIsle(env, isle.id))}`
  const errors: string[] = []
  const failed: string[] = []
  const slots: IsleCheck['slots'] = []
  const browser = await puppeteer.launch(env.BROWSER)
  try {
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: opts.dark ? 'dark' : 'light' }])
    page.on('pageerror', (e) => errors.push(`error: ${(e as Error).message ?? String(e)}`.slice(0, 500)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`.slice(0, 500)) })
    page.on('requestfailed', (r) => failed.push(`${r.url()} (${r.failure()?.errorText ?? 'failed'})`.slice(0, 300)))
    page.on('response', (r) => {
      const m = /\/data\/([A-Za-z_][\w-]{0,40})(\?|$)/.exec(new URL(r.url()).pathname + '?')
      if (m && r.url().startsWith(`${islesOrigin}/${isle.id}/data/`)) slots.push({ slot: m[1]!, status: r.status() })
      if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) failed.push(`${r.url()} (${r.status()})`.slice(0, 300))
    })
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25_000 }).catch((e) => errors.push(`load: ${(e as Error).message}`))
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(8000, opts.wait ?? 1500))))
    const info = (await page.evaluate(
      `(() => ({ text: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 1500), sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }))()`,
    )) as { text: string; sw: number; sh: number }
    const image = (await page.screenshot({ type: 'jpeg', quality: 70 })) as Uint8Array
    return { url, width, height, scheme: opts.dark ? 'dark' : 'light', errors, failed, slots, text: info.text, scroll: { width: info.sw, height: info.sh }, image }
  } finally {
    await browser.close()
  }
}
