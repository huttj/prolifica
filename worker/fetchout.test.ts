import { describe, expect, it } from 'vitest'
import { fetchOut } from './fetchout'

describe('fetchOut guards', () => {
  const own = ['https://prolifica.app', 'https://isles.prolifica.app']
  it.each([
    ['ftp://example.org/x', 'Only http and https'],
    ['file:///etc/passwd', 'Only http and https'],
    ['not a url', 'Not a web address'],
    ['https://prolifica.app/api/me', "Prolifica's own pages"],
    ['https://isles.prolifica.app/x', "Prolifica's own pages"],
    ['http://localhost:5190/', 'Private addresses'],
    ['http://127.0.0.1/', 'Private addresses'],
    ['http://10.1.2.3/', 'Private addresses'],
    ['http://192.168.0.1/', 'Private addresses'],
    ['http://172.20.0.1/', 'Private addresses'],
    ['http://169.254.169.254/latest/meta-data', 'Private addresses'],
    ['http://[::1]/', 'Private addresses'],
    ['http://printer.local/', 'Private addresses'],
  ])('refuses %s', async (url, why) => {
    const r = await fetchOut(url, ...own)
    expect('error' in r && r.error).toContain(why)
  })
})
