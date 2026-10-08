import { describe, expect, it } from 'vitest'
import { injectBridge } from './islehost'

const tags = (html: string) => html.indexOf('<script>window.__PROLIFICA__')

describe('injectBridge', () => {
  it('goes first thing inside <head>', () => {
    const out = injectBridge('<!doctype html><html><head><title>x</title></head><body></body></html>', { a: 1 })
    expect(out.indexOf('<head>') + '<head>'.length).toBe(tags(out))
    expect(out).toContain('<script src="/bridge.js"></script><title>')
  })
  it('makes a head when there is none', () => {
    const out = injectBridge('<html lang="en"><body>hi</body></html>', {})
    expect(out).toMatch(/^<html lang="en"><head><script>/)
  })
  it('handles a bare fragment', () => {
    expect(injectBridge('<div>hi</div>', {})).toMatch(/^<script>window/)
  })
  it('cannot be broken out of by the config', () => {
    const out = injectBridge('<head></head>', { title: '</script><script>alert(1)</script>' })
    expect(out).not.toContain('</script><script>alert(1)')
  })
  it('preloads the data before the bridge, escaped', () => {
    const out = injectBridge('<head></head>', {}, ['/abc123/data/rows?v=2&h=deadbeef"x'])
    expect(out).toMatch(/^<head><link rel="preload" href="\/abc123\/data\/rows\?v=2&#38;h=deadbeef&#34;x" as="fetch" crossorigin="anonymous"><script>/)
  })
})
