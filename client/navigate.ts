import { useEffect, useState } from 'react'

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  window.dispatchEvent(new Event('pf:navigate'))
  if (!to.includes('#')) window.scrollTo(0, 0)
}

export function usePath(): { path: string; query: URLSearchParams } {
  const read = () => ({ path: location.pathname, query: new URLSearchParams(location.search) })
  const [loc, setLoc] = useState(read)
  useEffect(() => {
    const on = () => setLoc(read())
    window.addEventListener('popstate', on)
    window.addEventListener('pf:navigate', on)
    return () => {
      window.removeEventListener('popstate', on)
      window.removeEventListener('pf:navigate', on)
    }
  }, [])
  return loc
}

/** Plain <a> for the router: new tabs and modified clicks still work. */
export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  const a = e.currentTarget
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return
  const url = new URL(a.href)
  if (url.origin !== location.origin) return
  e.preventDefault()
  navigate(url.pathname + url.search + url.hash)
}
