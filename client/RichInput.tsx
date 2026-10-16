// A text field that grows with its text and takes pasted or dropped images, which sit in the text
// where they were put (as image links to the person's data, shared/images.ts). The text is
// markdown, drawn live (mdlive.ts): the field rebuilds itself from the text after each change, so
// it keeps its own undo history. From Codinger (web/src/components/Inputs.tsx), images only.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from './api'
import { htmlToMarkdown } from './htmlmd'
import { activate, enterKey, fromDom, imageCaret, imgNode, rangeAt, render, select, selectionOffsets, snapCaret, wrapKey } from './mdlive'
import { imageUrl } from '../shared/images'
import { Icon, useSession } from './ui'

type Props = {
  value: string
  onChange(v: string): void
  placeholder?: string
  autoFocus?: boolean
  onSubmit?(): void
  onEscape?(): void
  minRows?: number
  disabled?: boolean
}

type Snap = { v: string; s: number; e: number; t: number }

function caretAt(x: number, y: number): Range | null {
  const d = document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    if (!p) return null
    const r = document.createRange()
    r.setStart(p.offsetNode, p.offset)
    return r
  }
  return document.caretRangeFromPoint?.(x, y) ?? null
}

export const imagesFrom = (dt: DataTransfer | null): File[] => [...(dt?.files ?? [])].filter((f) => f.type.startsWith('image/'))

// Pasted images become the person's data. Big ones shrink first: Claude downsamples anything past
// ~1568px anyway, read_data hands over images up to 1 MB, and storage is a few MB.
const MAX_SIDE = 1568
const MAX_BYTES = 900_000
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

export async function uploadImage(file: Blob): Promise<string> {
  let blob = file
  const bmp = file.type === 'image/gif' ? null : await createImageBitmap(file).catch(() => null)
  if (bmp && (Math.max(bmp.width, bmp.height) > MAX_SIDE || file.size > MAX_BYTES || !EXT[file.type])) {
    // a PNG stays a PNG if it fits; past that, JPEG at falling quality, then smaller
    let scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    let type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    let quality = 0.88
    for (;;) {
      const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale))
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
      blob = await canvas.convertToBlob({ type, quality })
      if (blob.size <= MAX_BYTES || scale < 0.2) break
      if (type === 'image/png') type = 'image/jpeg'
      else if (quality > 0.6) quality -= 0.14
      else scale *= 0.75
    }
  }
  if (!EXT[blob.type]) throw new Error('Use a PNG, JPEG, GIF or WebP image')
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')
  const d = await api.upload(`pasted/${new Date().toISOString().slice(0, 10)}-${hash}.${EXT[blob.type]}`, blob)
  return d.id
}

/** A picture over the page; a click or Escape closes it. */
export function Lightbox({ src, onClose }: { src: string; onClose(): void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return createPortal(
    <div className="lightbox" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <img src={src} alt="" />
    </div>,
    document.body,
  )
}

export function RichInput({ value, onChange, placeholder, autoFocus, onSubmit, onEscape, minRows = 2, disabled }: Props) {
  const { toast } = useSession()
  const ed = useRef<HTMLDivElement>(null)
  const fake = useRef<HTMLSpanElement>(null)       // the caret beside an image (mdlive.ts imageCaret)
  const last = useRef<string | null>(null)        // what this field last reported
  const caret = useRef<[number, number] | null>(null) // where the caret last was, as text offsets
  const composing = useRef(false)                  // an IME is mid-word: leave the DOM alone
  const past = useRef<Snap[]>([])                  // undo history, latest last
  const future = useRef<Snap[]>([])
  const change = useRef(onChange)
  change.current = onChange
  const [zoom, setZoom] = useState<string | null>(null)

  const emit = (v: string) => {
    const el = ed.current!
    el.toggleAttribute('data-empty', !v && !el.querySelector('img'))
    if (v === last.current) return
    last.current = v
    change.current(v)
  }
  // Typing within a moment of the last change is one step to undo, up to a space or line break.
  const record = (v: string, sel: [number, number] | null) => {
    const now = Date.now(), top = past.current.at(-1)
    const snap = { v, s: sel?.[0] ?? v.length, e: sel?.[1] ?? v.length, t: now }
    const breaks = /\s/.test(v[snap.s - 1] ?? '')
    if (top && top.v !== v && now - top.t < 600 && past.current.length > 1 && !breaks) past.current[past.current.length - 1] = snap
    else if (!top || top.v !== v) past.current.push(snap)
    if (past.current.length > 200) past.current.shift()
    future.current = []
  }
  const apply = (snap: Snap) => {
    const el = ed.current!
    render(el, snap.v)
    select(el, snap.s, snap.e)
    activate(el)
    emit(snap.v)
  }
  const undo = () => { if (past.current.length > 1) { future.current.push(past.current.pop()!); apply(past.current.at(-1)!) } }
  const redo = () => { const s = future.current.pop(); if (s) { past.current.push(s); apply(s) } }
  const edit = (v: string, s: number, e = s) => {
    const snap = { v, s, e, t: 0 }
    past.current.push(snap)
    future.current = []
    apply(snap)
  }

  // After the browser changes the DOM: read the text, draw it again, put the caret back.
  const sync = () => {
    const el = ed.current!
    const sel = selectionOffsets(el)
    const v = fromDom(el)
    // An image still uploading is not in the text yet; drawing again would drop it.
    if (!composing.current && !el.querySelector('img.loading')) {
      render(el, v)
      if (sel && document.activeElement === el) select(el, sel[0], sel[1])
    }
    activate(el)
    if (v !== last.current) record(v, sel)
    emit(v)
  }

  useLayoutEffect(() => {
    const el = ed.current!
    if (value === last.current) return
    last.current = value
    render(el, value)
    el.toggleAttribute('data-empty', !value)
    past.current = [{ v: value, s: value.length, e: value.length, t: 0 }]
    future.current = []
    if (document.activeElement === el) select(el, value.length)
  }, [value])

  useEffect(() => {
    if (!autoFocus) return
    const el = ed.current!
    el.focus({ preventScroll: true })
    select(el, fromDom(el).length)
  }, [autoFocus])

  useEffect(() => {
    const save = () => {
      const el = ed.current
      if (!el) return
      const sel = selectionOffsets(el)
      if (sel) caret.current = sel
      if (document.activeElement === el) snapCaret(el)
      activate(el)
      imageCaret(el, fake.current!)
    }
    // An image that loads changes size, and so moves the caret.
    const loaded = () => { if (ed.current) imageCaret(ed.current, fake.current!) }
    const el = ed.current!
    document.addEventListener('selectionchange', save)
    el.addEventListener('load', loaded, true)
    return () => { document.removeEventListener('selectionchange', save); el.removeEventListener('load', loaded, true) }
  }, [])

  const endOf = (el: HTMLElement) => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); return r }

  // Each image shows at once and fills in when its upload is done.
  async function add(files: File[], at: Range | null) {
    const el = ed.current!
    for (const f of files) {
      const img = imgNode(URL.createObjectURL(f))
      const r = at && el.contains(at.startContainer) ? at : caret.current ? rangeAt(el, caret.current[0], caret.current[1]) : endOf(el)
      r.deleteContents()
      r.insertNode(img)
      r.setStartAfter(img)
      r.collapse(true)
      if (document.activeElement === el) { const s = getSelection()!; s.removeAllRanges(); s.addRange(r) }
      at = r
      el.removeAttribute('data-empty')
      try {
        const id = await uploadImage(f)
        img.src = imageUrl(id)
        img.dataset.id = id
        img.classList.remove('loading')
      } catch (e) {
        img.remove()
        toast((e as Error).message)
      }
      sync()
      at = caret.current ? rangeAt(el, caret.current[1]) : null
    }
  }

  // Markdown keys and Enter change the text here, not in the DOM.
  const keyEdit = (e: React.KeyboardEvent) => {
    const el = ed.current!
    const sel = selectionOffsets(el)
    if (!sel || composing.current) return false
    const plainEnter = e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey
    const r = plainEnter ? enterKey(fromDom(el), sel[0], sel[1]) : wrapKey(e, fromDom(el), sel[0], sel[1])
    if (!r) return false
    edit(r.value, r.start, r.end)
    return true
  }

  // Copy gives the markdown as it is; the styled DOM would copy as odd indents.
  const copy = (e: React.ClipboardEvent, cut: boolean) => {
    const el = ed.current!
    const sel = selectionOffsets(el)
    if (!sel || sel[0] === sel[1]) return
    const v = fromDom(el)
    e.preventDefault()
    e.clipboardData.setData('text/plain', v.slice(sel[0], sel[1]))
    if (cut) edit(v.slice(0, sel[0]) + v.slice(sel[1]), sel[0])
  }
  // Paste keeps the formatting of rich text, as markdown.
  const paste = (e: React.ClipboardEvent) => {
    const f = imagesFrom(e.clipboardData)
    if (f.length) { e.preventDefault(); void add(f, null); return }
    const el = ed.current!
    const sel = selectionOffsets(el)
    const html = e.clipboardData.getData('text/html')
    const t = ((html && htmlToMarkdown(html)) || e.clipboardData.getData('text/plain')).replace(/\r\n?/g, '\n')
    if (!sel || !t || composing.current) return
    e.preventDefault()
    const v = fromDom(el)
    edit(v.slice(0, sel[0]) + t + v.slice(sel[1]), sel[0] + t.length)
  }

  return (
    <div
      className="rich-input"
      onDragOver={(e) => { if (imagesFrom(e.dataTransfer).length || e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={(e) => {
        const f = imagesFrom(e.dataTransfer)
        if (f.length) { e.preventDefault(); void add(f, caretAt(e.clientX, e.clientY)) }
      }}
    >
      <div className="ri-field">
        <div
          ref={ed}
          className="ri-edit"
          contentEditable={disabled ? false : 'plaintext-only'}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-disabled={disabled || undefined}
          data-placeholder={placeholder}
          style={{ minHeight: `${minRows * 20 + 20}px` }}
          onInput={sync}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false; sync() }}
          onBeforeInput={(e) => {
            const t = (e.nativeEvent as InputEvent).inputType
            if (t === 'historyUndo') { e.preventDefault(); undo() }
            if (t === 'historyRedo') { e.preventDefault(); redo() }
          }}
          onClick={(e) => {
            const img = (e.target as Element).closest?.<HTMLImageElement>('img.ri-img')
            if (img && !img.classList.contains('loading')) setZoom(img.src)
          }}
          onBlur={() => imageCaret(ed.current!, fake.current!)}
          onPaste={paste}
          onCopy={(e) => copy(e, false)}
          onCut={(e) => copy(e, true)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); return }
            if (keyEdit(e)) { e.preventDefault(); return }
            if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape() }
          }}
        />
        <span ref={fake} className="ri-caret" hidden />
        {!disabled && (
          <label className="attach" aria-label="Attach images" onMouseDown={(e) => e.preventDefault()}>
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { void add([...(e.target.files ?? [])], null); e.target.value = '' }} />
            <Icon name="image" />
          </label>
        )}
      </div>
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  )
}
