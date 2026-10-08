/**
 * The site a piece of data came from, as one name per site: "x.com" for twitter.com,
 * mobile.twitter.com and www.x.com alike. Sites are how Prolifica answers "how do I collect
 * from here, and what's already been collected?"
 */

const ALIASES: Record<string, string> = {
  'twitter.com': 'x.com',
  'youtu.be': 'youtube.com',
  'redd.it': 'reddit.com',
  'old.reddit.com': 'reddit.com',
  'new.reddit.com': 'reddit.com',
}

const DROP = /^(www\d*|m|mobile|amp)\./

export function siteOf(url: string | null | undefined): string | null {
  if (!url) return null
  let host: string
  try {
    host = new URL(/^[a-z][\w+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase()
  } catch {
    return null
  }
  if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host)) return null
  while (DROP.test(host)) host = host.replace(DROP, '')
  return ALIASES[host] ?? host
}

export const SITE_RE = /^[a-z0-9.-]+\.[a-z0-9-]{2,}$/
