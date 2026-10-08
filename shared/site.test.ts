import { describe, expect, it } from 'vitest'
import { siteOf } from './site'

describe('siteOf', () => {
  it('names a site once, whatever the prefix', () => {
    expect(siteOf('https://www.nytimes.com/2026/a.html')).toBe('nytimes.com')
    expect(siteOf('https://mobile.twitter.com/x/status/1')).toBe('x.com')
    expect(siteOf('https://x.com/someone/status/2')).toBe('x.com')
    expect(siteOf('https://old.reddit.com/r/foo')).toBe('reddit.com')
  })
  it('keeps real subdomains apart', () => {
    expect(siteOf('https://news.ycombinator.com/item?id=1')).toBe('news.ycombinator.com')
    expect(siteOf('https://someone.substack.com/p/x')).toBe('someone.substack.com')
  })
  it('takes a bare domain', () => {
    expect(siteOf('github.com/huttj')).toBe('github.com')
  })
  it('refuses what is not a web address', () => {
    expect(siteOf('localhost:3000')).toBeNull()
    expect(siteOf('http://127.0.0.1/x')).toBeNull()
    expect(siteOf('')).toBeNull()
    expect(siteOf(null)).toBeNull()
  })
})
