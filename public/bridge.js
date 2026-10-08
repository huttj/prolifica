/*
 * The Prolifica bridge, injected into every isle.
 *
 *   prolifica.data(slot)     the data bound to a slot: csv -> rows, json -> value, text -> string, image -> URL
 *   prolifica.dataUrl(slot)  its raw URL
 *   prolifica.bindings       {slot: {id, path, kind, contentType, hash}}
 *
 *   prolifica.onState({ get, set })  for isles with views (tabs, filters, a selected item): get()
 *                            returns something JSON-able that says what's showing, set(it) shows it
 *                            again. A mark remembers it, so a comment can bring its piece back.
 *
 * When the isle is framed by the app it also talks to it over postMessage: element picking
 * (for stars, reactions and comments on one element), pins for the marks already there, and
 * focusing one element: restoring the view it was marked in, then scrolling to it and ringing it.
 */
;(() => {
  const P = window.__PROLIFICA__ || {}
  const bindings = P.bindings || {}
  const memo = new Map()

  function dataUrl(slot) {
    if (!(slot in bindings)) throw new Error(`prolifica: this isle has no slot "${slot}" (slots: ${Object.keys(bindings).join(', ') || 'none'})`)
    const q = new URLSearchParams()
    if (P.version) q.set('v', P.version)
    if (P.grant) q.set('g', P.grant)
    // naming the content lets the browser keep it for good (and matches the page's preload)
    if (bindings[slot] && bindings[slot].hash) q.set('h', bindings[slot].hash)
    const qs = q.toString()
    return `/${P.isle.id}/data/${encodeURIComponent(slot)}${qs ? '?' + qs : ''}`
  }

  function parseCsv(text) {
    const rows = []
    let row = [], field = '', quoted = false
    text = text.replace(/^﻿/, '')
    const delim = text.split('\n', 1)[0].includes('\t') && !text.split('\n', 1)[0].includes(',') ? '\t' : ','
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false }
        else field += c
      } else if (c === '"' && field === '') quoted = true
      else if (c === delim) { row.push(field); field = '' }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++
        row.push(field); field = ''; rows.push(row); row = []
      } else field += c
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row) }
    const clean = rows.filter((r) => !(r.length === 1 && r[0] === ''))
    const header = clean.shift() || []
    const num = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/
    return clean.map((r) => {
      const o = {}
      header.forEach((h, i) => {
        const v = r[i] ?? ''
        o[h] = v !== '' && num.test(v.trim()) ? Number(v) : v
      })
      return o
    })
  }

  async function data(slot, opts = {}) {
    const b = bindings[slot]
    if (b === null) throw new Error(`prolifica: the data in slot "${slot}" was deleted`)
    const url = dataUrl(slot)
    const as = opts.as || (b && b.kind)
    if (as === 'image' || as === 'binary' || as === 'url') return url
    const key = `${slot}:${as}`
    if (!memo.has(key)) {
      memo.set(key, fetch(url).then(async (r) => {
        if (!r.ok) throw new Error(`prolifica: could not load slot "${slot}" (${r.status})`)
        const text = await r.text()
        if (as === 'csv') return parseCsv(text)
        if (as === 'json') return JSON.parse(text)
        return text
      }))
    }
    return memo.get(key)
  }

  let stateApi = null
  function onState(api) {
    stateApi = api && typeof api.get === 'function' && typeof api.set === 'function' ? api : null
  }

  window.prolifica = { isle: P.isle, slots: P.slots || {}, bindings, data, dataUrl, parseCsv, onState }

  // ---- talking to the app ----

  const framed = window.parent !== window && !!P.app
  const send = (msg) => window.parent.postMessage({ prolifica: 1, ...msg }, P.app)

  function whenReady(fn) {
    if (document.readyState === 'complete') setTimeout(fn, 50)
    else addEventListener('load', () => setTimeout(fn, 50))
  }

  // UI the bridge draws lives in one fixed layer and is skipped by picking
  let layer = null
  function ui() {
    if (layer && layer.isConnected) return layer
    layer = document.createElement('div')
    layer.setAttribute('data-prolifica-ui', '')
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646'
    const style = document.createElement('style')
    style.textContent = `
      [data-prolifica-ui] *{box-sizing:border-box;font:500 11px/1 ui-sans-serif,system-ui,-apple-system,sans-serif}
      [data-prolifica-ui] .pf-box{position:fixed;border:2px solid #0e9f8e;border-radius:4px;background:rgba(14,159,142,.08);transition:all .06s}
      [data-prolifica-ui] .pf-tag{position:fixed;background:#0e9f8e;color:#fff;padding:4px 7px;border-radius:5px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis}
      [data-prolifica-ui] .pf-hint{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);background:#10201f;color:#fff;padding:8px 12px;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.25)}
      [data-prolifica-ui] .pf-pin{position:fixed;pointer-events:auto;cursor:pointer;display:flex;gap:4px;align-items:center;background:#fff;color:#123;border:1px solid rgba(0,0,0,.12);box-shadow:0 2px 8px rgba(0,0,0,.15);border-radius:999px;padding:3px 7px;white-space:nowrap;transform:translateY(-50%)}
      [data-prolifica-ui] .pf-pin:hover{border-color:#0e9f8e}
      [data-prolifica-ui] .pf-pin.mine{background:#e8faf6}
      [data-prolifica-ui] .pf-focus{position:fixed;border-radius:6px;box-shadow:0 0 0 3px #0e9f8e,0 0 0 9999px rgba(8,20,20,.55);transition:all .2s}
      [data-prolifica-ui] .pf-focus.ring{box-shadow:0 0 0 3px #0e9f8e,0 0 0 8px rgba(14,159,142,.22);animation:pf-pulse 1.6s ease-out 2}
      @keyframes pf-pulse{0%{box-shadow:0 0 0 3px #0e9f8e,0 0 0 0 rgba(14,159,142,.45)}100%{box-shadow:0 0 0 3px #0e9f8e,0 0 0 14px rgba(14,159,142,0)}}
    `
    layer.appendChild(style)
    document.documentElement.appendChild(layer)
    return layer
  }
  const isOurs = (el) => !!(el && el.closest && el.closest('[data-prolifica-ui]'))

  // ---- stable selectors ----

  const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'))
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1 } catch { return false } }

  function selectorFor(el) {
    const parts = []
    let cur = el
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      const pid = cur.getAttribute('data-pid')
      if (pid) { parts.unshift(`[data-pid="${pid.replace(/"/g, '\\"')}"]`); break }
      if (cur.id && !/\d{3,}|^[a-f0-9-]{16,}$/i.test(cur.id) && unique(`#${cssEscape(cur.id)}`)) { parts.unshift(`#${cssEscape(cur.id)}`); break }
      if (cur === document.body) { parts.unshift('body'); break }
      const tag = cur.localName
      let nth = 1
      for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.localName === tag) nth++
      let more = false
      for (let sib = cur.nextElementSibling; sib; sib = sib.nextElementSibling) if (sib.localName === tag) { more = true; break }
      parts.unshift(nth > 1 || more ? `${tag}:nth-of-type(${nth})` : tag)
      cur = cur.parentElement
    }
    return parts.join(' > ')
  }

  function labelFor(el) {
    const own = el.getAttribute('data-label') || el.getAttribute('aria-label') || el.getAttribute('title')
    if (own) return own.trim().slice(0, 80)
    const heading = el.querySelector && el.querySelector('h1,h2,h3,h4,figcaption,caption,legend,title')
    if (heading && heading.textContent.trim()) return heading.textContent.trim().slice(0, 80)
    const pid = el.getAttribute('data-pid')
    if (pid) return pid.replace(/[-_]+/g, ' ')
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ')
    return text ? `${el.localName}: ${text.slice(0, 60)}` : el.localName
  }

  function anchorFor(el) {
    return { selector: selectorFor(el), label: labelFor(el), tag: el.localName, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 140), state: viewState() }
  }

  // ---- the view a piece was marked in, and getting back to it ----

  // the last few things clicked or changed, in case nothing better says how this view was reached
  let trail = []
  const STEPS = 'button,a,summary,label,select,input,[role=tab],[role=button],[role=option],[role=menuitem],[data-pid],[onclick]'
  function remember(e) {
    if (picking || isOurs(e.target) || !e.isTrusted) return
    const el = (e.target.closest && e.target.closest(STEPS)) || e.target
    if (!el || el === document.body || el === document.documentElement) return
    const sel = selectorFor(el)
    const step = e.type === 'change' && 'value' in el && el.type !== 'checkbox' && el.type !== 'radio' ? { sel, value: String(el.value).slice(0, 200) } : { sel }
    const last = trail[trail.length - 1]
    if (last && last.sel === sel && (step.value !== undefined || last.value === undefined)) trail[trail.length - 1] = step
    else trail.push(step)
    if (trail.length > 8) trail = trail.slice(-8)
  }

  function viewState() {
    const out = {}
    if (location.hash && !/^#focus=/.test(location.hash)) out.hash = location.hash.slice(0, 500)
    if (stateApi) {
      try {
        const v = stateApi.get()
        if (v !== undefined && JSON.stringify(v).length <= 3000) out.app = v
      } catch {}
    }
    if (trail.length) out.trail = trail.slice()
    return Object.keys(out).length ? out : undefined
  }

  // checkVisibility also sees content folded away by content-visibility (a closed <details>, for one)
  const shown = (el) =>
    !!el && el.isConnected &&
    (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }) : el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')

  function waitFor(selector, ms) {
    return new Promise((done) => {
      const t0 = performance.now()
      const tick = () => {
        const el = find(selector)
        if (shown(el)) return done(el)
        if (performance.now() - t0 > ms) return done(null)
        requestAnimationFrame(tick)
      }
      tick()
    })
  }

  function openDetails(el) {
    for (let d = el && el.closest && el.closest('details:not([open])'); d; d = d.parentElement && d.parentElement.closest('details:not([open])')) d.open = true
  }

  /** Find the piece, putting the isle back the way it was when the piece was marked if it isn't showing. */
  async function reveal(selector, state) {
    let el = find(selector)
    if (shown(el)) return el
    if (el) { openDetails(el); if (shown(el)) return el }
    if (!state) return el
    if (state.app !== undefined && stateApi) {
      try { await stateApi.set(state.app) } catch {}
      if ((el = await waitFor(selector, 1500))) return el
    }
    if (state.hash && location.hash !== state.hash) {
      location.hash = state.hash
      if ((el = await waitFor(selector, 1500))) return el
    }
    for (const step of state.trail || []) {
      const t = find(step.sel)
      if (!t) continue
      if (step.value !== undefined && 'value' in t) {
        t.value = step.value
        t.dispatchEvent(new Event('input', { bubbles: true }))
        t.dispatchEvent(new Event('change', { bubbles: true }))
      } else t.click()
      if ((el = await waitFor(selector, 500))) return el
    }
    el = find(selector)
    if (el) openDetails(el)
    return el
  }

  function snippetOf(el) {
    let html = el.outerHTML || ''
    if (html.length > 8000) html = html.slice(0, 8000) + '<!-- … -->'
    return html
  }

  function find(selector) {
    try { return document.querySelector(selector) } catch { return null }
  }

  // ---- picking ----

  let picking = false
  let target = null
  let depth = 0
  let base = null
  let box, tag, hint

  function draw() {
    if (!target) return
    const r = target.getBoundingClientRect()
    Object.assign(box.style, { left: r.left - 2 + 'px', top: r.top - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px', display: 'block' })
    tag.textContent = labelFor(target)
    Object.assign(tag.style, { left: Math.max(4, r.left) + 'px', top: (r.top > 28 ? r.top - 26 : r.bottom + 6) + 'px', display: 'block' })
  }

  function climb(el, n) {
    let cur = el
    for (let i = 0; i < n && cur && cur.parentElement && cur.parentElement !== document.documentElement; i++) cur = cur.parentElement
    return cur
  }

  // prefer the nearest element someone named with data-pid
  function natural(el) {
    const named = el.closest && el.closest('[data-pid]')
    return named || el
  }

  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el || isOurs(el)) return
    if (el !== base) { base = el; depth = 0 }
    target = climb(natural(el), depth)
    draw()
  }

  function onKey(e) {
    if (e.key === 'Escape') { stopPicking(); send({ t: 'pickCancel' }); return }
    if (!base) return
    if (e.key === 'ArrowUp' || e.key === '[') { depth++; target = climb(natural(base), depth); draw(); e.preventDefault() }
    if ((e.key === 'ArrowDown' || e.key === ']') && depth > 0) { depth--; target = climb(natural(base), depth); draw(); e.preventDefault() }
  }

  function onClick(e) {
    if (!target || isOurs(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    const r = target.getBoundingClientRect()
    send({ t: 'picked', anchor: anchorFor(target), snippet: snippetOf(target), rect: { x: r.left, y: r.top, w: r.width, h: r.height } })
    stopPicking()
  }

  function startPicking() {
    if (picking) return
    picking = true
    const root = ui()
    box = document.createElement('div'); box.className = 'pf-box'; box.style.display = 'none'
    tag = document.createElement('div'); tag.className = 'pf-tag'; tag.style.display = 'none'
    hint = document.createElement('div'); hint.className = 'pf-hint'; hint.textContent = 'Click a piece to mark it · ↑ ↓ for bigger or smaller · Esc to stop'
    root.append(box, tag, hint)
    addEventListener('mousemove', onMove, true)
    addEventListener('click', onClick, true)
    addEventListener('keydown', onKey, true)
    document.documentElement.style.cursor = 'crosshair'
  }

  function stopPicking() {
    if (!picking) return
    picking = false
    target = base = null
    box && box.remove(); tag && tag.remove(); hint && hint.remove()
    removeEventListener('mousemove', onMove, true)
    removeEventListener('click', onClick, true)
    removeEventListener('keydown', onKey, true)
    document.documentElement.style.cursor = ''
  }

  // ---- pins for the marks already there ----

  let pins = []
  function setPins(items) {
    pins.forEach((p) => p.node.remove())
    pins = []
    const root = ui()
    for (const it of items || []) {
      if (!it.selector) continue
      const node = document.createElement('div')
      node.className = 'pf-pin' + (it.mine ? ' mine' : '')
      node.textContent = it.text
      node.title = it.title || ''
      node.addEventListener('click', (e) => { e.stopPropagation(); send({ t: 'open', key: it.selector }) })
      root.appendChild(node)
      pins.push({ node, selector: it.selector })
    }
    placePins()
  }
  function placePins() {
    for (const p of pins) {
      const el = find(p.selector)
      if (!el) { p.node.style.display = 'none'; continue }
      const r = el.getBoundingClientRect()
      const visible = r.bottom > 0 && r.top < innerHeight && r.width + r.height > 0
      p.node.style.display = visible ? 'flex' : 'none'
      p.node.style.right = Math.max(4, innerWidth - r.right - 6) + 'px'
      p.node.style.top = Math.max(12, r.top) + 'px'
    }
    if (focusEl) placeFocus()
  }
  addEventListener('scroll', () => requestAnimationFrame(placePins), { passive: true, capture: true })
  addEventListener('resize', () => requestAnimationFrame(placePins))

  // ---- focusing one element ----

  let focusEl = null
  let focusBox = null
  let focusTimer = 0
  function placeFocus() {
    if (!focusEl || !focusBox) return
    const r = focusEl.getBoundingClientRect()
    Object.assign(focusBox.style, { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' })
  }
  function clearFocus() {
    clearTimeout(focusTimer)
    focusBox && focusBox.remove()
    focusBox = null
    focusEl = null
  }
  // mode: 'spot' dims everything else (library), 'ring' stays until clicked away, 'flash' fades
  async function focusOn(selector, mode, state) {
    clearFocus()
    if (!selector) return false
    const el = await reveal(selector, state)
    if (!el) return false
    focusEl = el
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: mode === 'spot' ? 'instant' : 'smooth' })
    focusBox = document.createElement('div')
    focusBox.className = 'pf-focus' + (mode === 'spot' ? '' : ' ring')
    ui().appendChild(focusBox)
    placeFocus()
    if (mode === 'flash') focusTimer = setTimeout(clearFocus, 2200)
    return shown(el)
  }

  const hashFocus = () => new URLSearchParams(location.hash.slice(1)).get('focus')
  if (!framed) {
    // opened on its own: #focus=<selector> still spotlights one element
    if (hashFocus()) whenReady(() => focusOn(hashFocus(), 'spot'))
    return
  }
  setInterval(placePins, 800)
  addEventListener('click', remember, true)
  addEventListener('change', remember, true)
  // a ring stays until the reader clicks somewhere in the isle
  addEventListener('pointerdown', (e) => { if (focusBox && !focusBox.classList.contains('spot') && !isOurs(e.target) && focusBox.classList.contains('ring')) { clearFocus(); send({ t: 'unfocused' }) } }, true)

  addEventListener('message', (e) => {
    if (e.origin !== P.app || e.source !== window.parent) return
    const m = e.data || {}
    if (!m.prolifica) return
    if (m.t === 'pick') m.on ? startPicking() : stopPicking()
    else if (m.t === 'pins') setPins(m.items)
    else if (m.t === 'focus') focusOn(m.selector, m.mode || (m.dim ? 'spot' : 'flash'), m.state).then((ok) => send({ t: 'focused', ok, selector: m.selector }))
  })

  whenReady(() => {
    send({ t: 'ready', title: document.title })
    if (hashFocus()) focusOn(hashFocus(), 'spot')
  })
})()
