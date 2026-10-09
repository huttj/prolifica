/**
 * Fetch an outside address for fetch_url: http(s) only, not this app's own hosts or private
 * addresses, 15 seconds and 10 MB at most.
 */
export async function fetchOut(raw: string, ...own: string[]): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string; finalUrl: string } | { error: string }> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { error: 'Not a web address' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'Only http and https addresses' }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const ownHosts = own.map((o) => { try { return new URL(o).hostname } catch { return '' } })
  if (ownHosts.includes(host) || host.endsWith('.prolifica.app') || host === 'prolifica.app') return { error: "Prolifica's own pages: use read_data, get_isle or check_isle instead" }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^(::1?|f[cd][0-9a-f]{2}:.*|fe80:.*)$/.test(host))
    return { error: 'Private addresses are off limits' }
  let res: Response
  try {
    res = await fetch(url.toString(), { redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Prolifica/1.0 (+https://prolifica.app)', accept: '*/*' } })
  } catch (e) {
    return { error: `Couldn't fetch it: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!res.ok) return { error: `The site answered ${res.status} ${res.statusText}`.trim() }
  const max = 10 * 1024 * 1024
  if (Number(res.headers.get('content-length') ?? 0) > max) return { error: 'Over 10 MB' }
  const reader = res.body?.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  if (reader)
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) {
        await reader.cancel()
        return { error: 'Over 10 MB' }
      }
      parts.push(value)
    }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const p of parts) { bytes.set(p, at); at += p.length }
  const contentType = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase()
  return { bytes, contentType, finalUrl: res.url || url.toString() }
}
