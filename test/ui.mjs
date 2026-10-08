// UI smoke test against a running dev server: node test/ui.mjs <session cookie> <isle id> [outdir]
import puppeteer from 'puppeteer-core'

const [session, isleId, out = '/tmp'] = process.argv.slice(2)
const B = 'http://localhost:5190'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1360, height: 860 })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
if (session) await browser.setCookie({ name: 'pro_session', value: session, domain: 'localhost', path: '/' })
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(B + '/', { waitUntil: 'networkidle0' })
await wait(800)
await shot('home')

await page.goto(`${B}/i/${isleId}`, { waitUntil: 'networkidle0' })
await wait(1200)
await shot('isle')

// mark a piece: pick mode, then click the chart inside the isle
const pick = await page.$$eval('button', (bs) => bs.findIndex((b) => b.textContent.includes('Mark a piece')))
await (await page.$$('button'))[pick].click()
await wait(300)
const frame = page.frames().find((f) => f.url().startsWith('http://127.0.0.1') && f.url().includes(isleId))
const box = await (await page.$('.isle-frame iframe')).boundingBox()
const rect = await frame.$eval('[data-pid="avg-mood"]', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await page.mouse.move(box.x + rect.x, box.y + rect.y)
await wait(200)
await shot('picking')
await page.mouse.click(box.x + rect.x, box.y + rect.y)
await wait(500)
const chip = await page.$eval('.compose .anchor-chip', (el) => el.textContent).catch(() => null)
console.log('picked anchor chip:', chip)
const starBtn = await page.$$eval('.compose button', (bs) => bs.findIndex((b) => b.textContent.includes('Star this piece')))
if (starBtn >= 0) (await page.$$('.compose button'))[starBtn].click()
await wait(900)
const pins = await frame.$$eval('[data-prolifica-ui] .pf-pin', (ps) => ps.map((p) => p.textContent))
console.log('pins in isle:', pins)
await shot('isle-marked')

for (const [name, path] of [['library', '/library'], ['tree', '/tree'], ['data', '/data'], ['connect', '/connect'], ['profile', '/@alice']]) {
  await page.goto(B + path, { waitUntil: 'networkidle0' })
  await wait(1200)
  await shot(name)
}
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
await page.goto(`${B}/i/${isleId}`, { waitUntil: 'networkidle0' })
await wait(1200)
await shot('isle-dark')
await page.setViewport({ width: 390, height: 844 })
await page.goto(`${B}/`, { waitUntil: 'networkidle0' })
await wait(800)
await shot('home-mobile')
console.log(errors.length ? errors.join('\n') : 'no page errors')
await browser.close()
